import { pathToFileURL } from 'node:url'
import { loadPublishContext } from './account-session.js'
import { openDatabase } from '../db/client.js'
import { getBookPublicationById, updateBookPublicationBinding } from '../db/repositories/book-publications-repo.js'
import { getChapterPublicationsByBookPublicationId, upsertChapterPublication } from '../db/repositories/chapter-publications-repo.js'
import { getChaptersByBookId } from '../db/repositories/chapters-repo.js'
import { getPlatformAccountById } from '../db/repositories/platform-accounts-repo.js'
import { getPublishPlatformAdapter } from './platform-registry.js'
import type { ChapterPublicationStatus, PublishPageLike } from './publisher-adapter.js'
import { AdapterNotConfiguredError } from './publisher-adapter.js'
import { parseChapterFile } from '../fs/chapter-parser.js'

export type PublishJobInput = {
  databasePath: string
  bookPublicationId: string
}

export type PublishJobChapterResult = {
  chapterId: string
  platformChapterId: string | null
  status: ChapterPublicationStatus
}

export type PublishJobResult = {
  publicationId: string
  platform: string
  platformBookId: string
  attemptedChapterIds: string[]
  chapters: PublishJobChapterResult[]
}

type PublishBrowserContext = {
  pages(): PublishPageLike[]
  newPage(): Promise<PublishPageLike>
  close(): Promise<void>
}

type BookRow = {
  id: string
  title: string
  root_path: string
}

function readPublishPage(context: PublishBrowserContext) {
  return context.pages()[0] ?? context.newPage()
}

export async function runPublishJob(input: PublishJobInput): Promise<PublishJobResult> {
  const db = openDatabase(input.databasePath)

  let context: PublishBrowserContext | null = null
  try {
    const publication = getBookPublicationById(db, input.bookPublicationId)
    if (!publication) {
      throw new Error('Book publication not found')
    }

    const account = getPlatformAccountById(db, publication.platformAccountId)
    if (!account) {
      throw new Error('Platform account not found')
    }
    if (publication.status === 'paused') {
      throw new Error('Book publication is paused and cannot publish')
    }
    if (account.status !== 'active') {
      throw new Error('Platform account must be active before publishing')
    }
    if (!account.profilePath) {
      throw new Error('Platform account is missing profilePath required for publish context')
    }

    const book = db.prepare('SELECT id, title, root_path FROM books WHERE id = ?').get(publication.bookId) as BookRow | undefined
    if (!book) {
      throw new Error('Book not found')
    }

    const chapters = getChaptersByBookId(db, book.id)
      .filter((chapter) => chapter.stage === '可发布')
      .sort((a, b) => a.chapterNumber - b.chapterNumber)

    const adapter = getPublishPlatformAdapter(publication.platform)
    if (!adapter) {
      throw new AdapterNotConfiguredError(publication.platform, 'publish')
    }

    context = await loadPublishContext(account.profilePath) as PublishBrowserContext
    const page = await readPublishPage(context)

    await adapter.openBackend(page)
    await adapter.ensureLoggedIn(page)

    let platformBookId = publication.platformBookId
    if (!platformBookId) {
      const binding = await adapter.bindBook(page, {
        id: book.id,
        title: book.title,
        rootPath: book.root_path,
      })
      platformBookId = binding.platformBookId
      updateBookPublicationBinding(db, publication.id, {
        platformBookId,
        status: 'bound',
      })
    }

    const existingChapterPublications = new Map(
      getChapterPublicationsByBookPublicationId(db, publication.id).map((row) => [row.chapterId, row]),
    )

    const results: PublishJobChapterResult[] = []

    for (const chapter of chapters) {
      const parsed = await parseChapterFile(pathToFileURL(chapter.sourcePath))
      if (!parsed) {
        throw new Error(`Could not parse chapter file for ${chapter.id}`)
      }

      const existingChapterPublication = existingChapterPublications.get(chapter.id)
      const published = await adapter.publishChapter(page, {
        bookPublicationId: publication.id,
        chapterId: chapter.id,
        platformBookId,
        platformChapterId: existingChapterPublication?.platformChapterId ?? '',
        title: chapter.title,
        content: parsed.body,
      })

      const platformChapterId = published.platformChapterId ?? existingChapterPublication?.platformChapterId ?? null
      if ((published.status === 'synced' || published.status === 'published') && !published.platformChapterId) {
        throw new Error('publishChapter must return platformChapterId for synced or published statuses')
      }

      upsertChapterPublication(db, {
        chapterId: chapter.id,
        bookPublicationId: publication.id,
        platformChapterId,
        status: published.status,
      })

      results.push({
        chapterId: chapter.id,
        platformChapterId,
        status: published.status,
      })
    }

    return {
      publicationId: publication.id,
      platform: publication.platform,
      platformBookId,
      attemptedChapterIds: chapters.map((chapter) => chapter.id),
      chapters: results,
    }
  } finally {
    try {
      await context?.close()
    } finally {
      db.close()
    }
  }
}

export async function runDryPublishJob(input: { chapterIds: string[] }) {
  return input.chapterIds.map((chapterId) => ({ chapterId, status: 'verified-dry-run' as const }))
}
