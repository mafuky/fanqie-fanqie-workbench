import type { FastifyInstance } from 'fastify'
import { rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { openDatabase } from '../../db/client.js'
import { syncWorkspaceBooks } from '../../db/repositories/books-repo.js'
import {
  createBookPublication,
  getBookPublicationByBookIdAndPlatform,
  getBookPublicationById,
  getBookPublicationsByBookId,
  updateBookPublication,
} from '../../db/repositories/book-publications-repo.js'
import { getChapterPublicationsByBookPublicationId } from '../../db/repositories/chapter-publications-repo.js'
import { getPlatformAccountById } from '../../db/repositories/platform-accounts-repo.js'
import type { ChapterStage } from '../../domain/chapter.js'
import type { AccountStatus } from '../../domain/account.js'
import type { BookPublicationRecord, BookPublicationStatus, ChapterPublicationStatus } from '../../domain/publication.js'
import type { PlatformAccountRecord } from '../../domain/platform-account.js'
import type { SupportedPlatform } from '../../domain/platform.js'
import { runPublishJob } from '../../publish/publish-runner.js'
import { AdapterNotConfiguredError } from '../../publish/publisher-adapter.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}
const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')
const NOVELS_ROOT = resolve(WORKSPACE_ROOT, 'novels')
const ALL_STAGES: ChapterStage[] = ['待写作', '已初稿', '已去AI', '已审稿', '可发布', '发布中', '已发布']
const VALID_BOOK_PUBLICATION_STATUSES: BookPublicationStatus[] = ['draft', 'bound', 'paused']
const CHAPTER_PUBLICATION_STATUSES: ChapterPublicationStatus[] = ['pending', 'synced', 'published', 'failed']

function readNonEmptyString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function summarizeChapterStatuses(rows: Array<{ status: ChapterPublicationStatus; lastPublishedAt: string | null }>) {
  const counts = {
    pending: 0,
    synced: 0,
    published: 0,
    failed: 0,
  }

  let latestPublishedAt: string | null = null

  for (const row of rows) {
    counts[row.status] += 1
    if (row.lastPublishedAt && (!latestPublishedAt || row.lastPublishedAt > latestPublishedAt)) {
      latestPublishedAt = row.lastPublishedAt
    }
  }

  return { counts, latestPublishedAt }
}

function buildDefaultPendingRows(chapterCount: number) {
  return Array.from({ length: chapterCount }, () => ({ status: 'pending' as const, lastPublishedAt: null }))
}

function canPublish(publicationStatus: BookPublicationStatus, accountStatus: AccountStatus) {
  return publicationStatus !== 'paused' && accountStatus === 'active'
}

function toPublicationSummary(
  publication: BookPublicationRecord,
  account: PlatformAccountRecord,
  chapterRows: Array<{ status: ChapterPublicationStatus; lastPublishedAt: string | null }>,
) {
  const { counts, latestPublishedAt } = summarizeChapterStatuses(chapterRows)
  return {
    ...publication,
    account: {
      id: account.id,
      label: account.label,
      status: account.status,
    },
    chapterStatusCounts: counts,
    latestPublishedAt,
    canPublish: canPublish(publication.status, account.status),
  }
}

function readCreatePublicationBody(body: unknown) {
  const record = (body ?? {}) as Record<string, unknown>
  const platform = readNonEmptyString(record.platform)
  if (!platform) {
    return { error: 'platform is required' as const }
  }

  const platformAccountId = readNonEmptyString(record.platformAccountId)
  if (!platformAccountId) {
    return { error: 'platformAccountId is required' as const }
  }

  return {
    value: {
      platform: platform as SupportedPlatform,
      platformAccountId,
    },
  }
}

function readPatchPublicationBody(body: unknown) {
  const record = (body ?? {}) as Record<string, unknown>
  const allowedKeys = ['platformAccountId', 'platformBookId', 'status']
  const extraKeys = Object.keys(record).filter((key) => !allowedKeys.includes(key))
  if (extraKeys.length > 0) {
    return { error: 'PATCH body only supports platformAccountId, platformBookId, status' as const }
  }

  const patch: {
    platformAccountId?: string
    platformBookId?: string | null
    status?: BookPublicationStatus
  } = {}

  if (record.platformAccountId !== undefined) {
    const platformAccountId = readNonEmptyString(record.platformAccountId)
    if (!platformAccountId) {
      return { error: 'platformAccountId must be a non-empty string' as const }
    }
    patch.platformAccountId = platformAccountId
  }

  if (record.platformBookId !== undefined) {
    if (record.platformBookId !== null && typeof record.platformBookId !== 'string') {
      return { error: 'platformBookId must be a string or null' as const }
    }
    patch.platformBookId = record.platformBookId === null ? null : record.platformBookId
  }

  if (record.status !== undefined) {
    if (typeof record.status !== 'string' || !VALID_BOOK_PUBLICATION_STATUSES.includes(record.status as BookPublicationStatus)) {
      return { error: 'status must be one of draft, bound, paused' as const }
    }
    patch.status = record.status as BookPublicationStatus
  }

  return { patch }
}

function validatePublicationPatchState(
  publication: BookPublicationRecord,
  patch: { platformBookId?: string | null; status?: BookPublicationStatus },
) {
  const finalStatus = patch.status ?? publication.status
  const finalPlatformBookId = patch.platformBookId !== undefined ? patch.platformBookId : publication.platformBookId

  if (finalStatus === 'bound' && !readNonEmptyString(finalPlatformBookId)) {
    return 'status bound requires a non-empty platformBookId' as const
  }

  return null
}

function isPathInside(parent: string, child: string) {
  const rel = relative(parent, child)
  return rel.length > 0 && !rel.startsWith('..') && !rel.startsWith('/')
}

export async function registerBookRoutes(app: FastifyInstance) {
  app.get('/api/books', async () => {
    const db = openDatabase(getDatabasePath())
    try {
      const books = db.prepare('SELECT id, title, root_path, account_id FROM books ORDER BY title').all()
      return { books }
    } finally {
      db.close()
    }
  })

  app.post('/api/books/scan', async () => {
    const summary = await syncWorkspaceBooks({ novelsRoot: NOVELS_ROOT, databasePath: getDatabasePath() })
    return summary
  })

  app.delete<{ Params: { bookId: string } }>('/api/books/:bookId', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    let rootPath: string | null = null
    try {
      const book = db.prepare('SELECT id, root_path FROM books WHERE id = ?').get(request.params.bookId) as { id: string; root_path: string } | undefined
      if (!book) {
        return reply.code(404).send({ error: 'book not found' })
      }

      rootPath = resolve(book.root_path)
      const chapterIds = (db.prepare('SELECT id FROM chapters WHERE book_id = ?').all(request.params.bookId) as Array<{ id: string }>).map((chapter) => chapter.id)
      const bookPublicationIds = (db.prepare('SELECT id FROM book_publications WHERE book_id = ?').all(request.params.bookId) as Array<{ id: string }>).map((publication) => publication.id)
      const sessionIds = (db.prepare('SELECT id FROM sessions WHERE book_id = ? OR chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)').all(request.params.bookId, request.params.bookId) as Array<{ id: string }>).map((session) => session.id)
      const taskIds = (db.prepare('SELECT id FROM tasks WHERE book_id = ? OR chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)').all(request.params.bookId, request.params.bookId) as Array<{ id: string }>).map((task) => task.id)

      const removeBook = db.transaction(() => {
        if (sessionIds.length > 0) {
          const placeholders = sessionIds.map(() => '?').join(', ')
          db.prepare(`DELETE FROM session_messages WHERE session_id IN (${placeholders})`).run(...sessionIds)
          db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...sessionIds)
        }

        if (taskIds.length > 0) {
          const placeholders = taskIds.map(() => '?').join(', ')
          db.prepare(`DELETE FROM task_logs WHERE task_id IN (${placeholders})`).run(...taskIds)
          db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...taskIds)
        }

        if (bookPublicationIds.length > 0) {
          const placeholders = bookPublicationIds.map(() => '?').join(', ')
          db.prepare(`DELETE FROM chapter_publications WHERE book_publication_id IN (${placeholders})`).run(...bookPublicationIds)
          db.prepare(`DELETE FROM book_publications WHERE id IN (${placeholders})`).run(...bookPublicationIds)
        }

        if (chapterIds.length > 0) {
          const placeholders = chapterIds.map(() => '?').join(', ')
          db.prepare(`DELETE FROM chapter_publications WHERE chapter_id IN (${placeholders})`).run(...chapterIds)
          db.prepare(`DELETE FROM chapters WHERE id IN (${placeholders})`).run(...chapterIds)
        }

        db.prepare('DELETE FROM books WHERE id = ?').run(request.params.bookId)
      })

      removeBook()
    } finally {
      db.close()
    }

    if (rootPath && isPathInside(NOVELS_ROOT, rootPath)) {
      await rm(rootPath, { recursive: true, force: true })
    }

    return reply.code(204).send()
  })

  app.get<{ Params: { bookId: string } }>('/api/books/:bookId', async (request) => {
    const { bookId } = request.params
    const db = openDatabase(getDatabasePath())
    try {
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId)
      const chapters = db.prepare(
        'SELECT id, chapter_number, title, source_path, stage FROM chapters WHERE book_id = ? ORDER BY chapter_number',
      ).all(bookId) as Array<{ id: string; chapter_number: number; title: string; source_path: string; stage: ChapterStage }>
      const activeSession = db.prepare(
        `SELECT id, chapter_id
         FROM sessions
         WHERE book_id = ? AND status IN ('running', 'waiting-answer')
         ORDER BY updated_at DESC
         LIMIT 1`,
      ).get(bookId) as { id: string; chapter_id: string | null } | undefined

      const byStage = Object.fromEntries(ALL_STAGES.map((stage) => [stage, 0])) as Record<ChapterStage, number>
      for (const chapter of chapters) {
        byStage[chapter.stage] += 1
      }

      return {
        book,
        chapters,
        summary: {
          totalChapters: chapters.length,
          byStage,
          publishableCount: byStage['可发布'],
          activeSessionId: activeSession?.id ?? null,
          activeChapterId: activeSession?.chapter_id ?? null,
        },
      }
    } finally {
      db.close()
    }
  })

  app.get<{ Params: { bookId: string } }>('/api/books/:bookId/sessions', async (request) => {
    const { bookId } = request.params
    const db = openDatabase(getDatabasePath())
    try {
      const sessions = db.prepare(
        `SELECT id, kind, book_id AS bookId, chapter_id AS chapterId, status, current_skill AS currentSkill,
                pending_question_json AS pendingQuestionJson, created_at AS createdAt, updated_at AS updatedAt
         FROM sessions
         WHERE book_id = ?
         ORDER BY updated_at DESC
         LIMIT 20`,
      ).all(bookId)
      return { sessions }
    } finally {
      db.close()
    }
  })

  app.get<{ Params: { bookId: string } }>('/api/books/:bookId/publications', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    try {
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(request.params.bookId)
      if (!book) {
        return reply.code(404).send({ error: 'book not found' })
      }

      const publicationRecords = getBookPublicationsByBookId(db, request.params.bookId)
      const chapterCount = (db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE book_id = ?').get(request.params.bookId) as { count: number }).count
      const publications = publicationRecords.map((publication) => {
        const account = getPlatformAccountById(db, publication.platformAccountId)
        if (!account) {
          throw new Error(`Platform account ${publication.platformAccountId} not found`)
        }
        const chapterRows = getChapterPublicationsByBookPublicationId(db, publication.id)
        const summaryRows = chapterRows.length > 0 ? chapterRows : buildDefaultPendingRows(chapterCount)
        return toPublicationSummary(publication, account, summaryRows)
      })

      return { publications }
    } finally {
      db.close()
    }
  })

  app.post<{ Params: { bookId: string }; Body: { platform?: string; platformAccountId?: string } }>(
    '/api/books/:bookId/publications',
    async (request, reply) => {
      const parsed = readCreatePublicationBody(request.body)
      if ('error' in parsed) {
        return reply.code(400).send({ error: parsed.error })
      }

      const db = openDatabase(getDatabasePath())
      try {
        const book = db.prepare('SELECT id FROM books WHERE id = ?').get(request.params.bookId)
        if (!book) {
          return reply.code(404).send({ error: 'book not found' })
        }

        const account = getPlatformAccountById(db, parsed.value.platformAccountId)
        if (!account) {
          return reply.code(404).send({ error: 'platform account not found' })
        }

        if (account.platform !== parsed.value.platform) {
          return reply.code(400).send({ error: 'platformAccountId must belong to the same platform' })
        }

        const existing = getBookPublicationByBookIdAndPlatform(db, request.params.bookId, parsed.value.platform)
        if (existing) {
          return reply.code(400).send({ error: 'book publication already exists for this platform' })
        }

        const publication = createBookPublication(db, {
          bookId: request.params.bookId,
          platform: parsed.value.platform,
          platformAccountId: parsed.value.platformAccountId,
        })

        const chapterCount = (db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE book_id = ?').get(request.params.bookId) as { count: number }).count
        const summary = toPublicationSummary(publication, account, buildDefaultPendingRows(chapterCount))
        return reply.code(201).send(summary)
      } catch (error) {
        if (error instanceof Error && /already exists/i.test(error.message)) {
          return reply.code(400).send({ error: 'book publication already exists for this platform' })
        }
        if (error instanceof Error && /must match book publication platform/i.test(error.message)) {
          return reply.code(400).send({ error: 'platformAccountId must belong to the same platform' })
        }
        if (error instanceof Error && /not found/i.test(error.message)) {
          return reply.code(404).send({ error: 'platform account not found' })
        }
        throw error
      } finally {
        db.close()
      }
    },
  )

  app.get<{ Params: { id: string } }>('/api/book-publications/:id', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    try {
      const publication = getBookPublicationById(db, request.params.id)
      if (!publication) {
        return reply.code(404).send({ error: 'book publication not found' })
      }

      const account = getPlatformAccountById(db, publication.platformAccountId)
      if (!account) {
        return reply.code(404).send({ error: 'platform account not found' })
      }

      const chapterRows = getChapterPublicationsByBookPublicationId(db, publication.id)
      const chapterCount = (db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE book_id = ?').get(publication.bookId) as { count: number }).count
      const summaryRows = chapterRows.length > 0 ? chapterRows : buildDefaultPendingRows(chapterCount)
      return toPublicationSummary(publication, account, summaryRows)
    } finally {
      db.close()
    }
  })

  app.patch<{
    Params: { id: string }
    Body: { platformAccountId?: string; platformBookId?: string | null; status?: BookPublicationStatus }
  }>('/api/book-publications/:id', async (request, reply) => {
    const parsed = readPatchPublicationBody(request.body)
    if ('error' in parsed) {
      return reply.code(400).send({ error: parsed.error })
    }

    const db = openDatabase(getDatabasePath())
    try {
      const publication = getBookPublicationById(db, request.params.id)
      if (!publication) {
        return reply.code(404).send({ error: 'book publication not found' })
      }

      let account = getPlatformAccountById(db, publication.platformAccountId)
      if (!account) {
        return reply.code(404).send({ error: 'platform account not found' })
      }

      if (parsed.patch.platformAccountId !== undefined) {
        const nextAccount = getPlatformAccountById(db, parsed.patch.platformAccountId)
        if (!nextAccount) {
          return reply.code(404).send({ error: 'platform account not found' })
        }
        if (nextAccount.platform !== publication.platform) {
          return reply.code(400).send({ error: 'platformAccountId must belong to the same platform' })
        }
        account = nextAccount
      }

      const patchStateError = validatePublicationPatchState(publication, parsed.patch)
      if (patchStateError) {
        return reply.code(400).send({ error: patchStateError })
      }

      updateBookPublication(db, request.params.id, parsed.patch)

      const updated = getBookPublicationById(db, request.params.id)
      if (!updated) {
        return reply.code(404).send({ error: 'book publication not found' })
      }

      const chapterRows = getChapterPublicationsByBookPublicationId(db, updated.id)
      const chapterCount = (db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE book_id = ?').get(updated.bookId) as { count: number }).count
      const summaryRows = chapterRows.length > 0 ? chapterRows : buildDefaultPendingRows(chapterCount)
      return toPublicationSummary(updated, account, summaryRows)
    } finally {
      db.close()
    }
  })

  app.get<{ Params: { id: string } }>('/api/book-publications/:id/chapters', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    try {
      const publication = getBookPublicationById(db, request.params.id)
      if (!publication) {
        return reply.code(404).send({ error: 'book publication not found' })
      }

      const chapters = getChapterPublicationsByBookPublicationId(db, publication.id)
      return { chapters }
    } finally {
      db.close()
    }
  })

  app.post<{ Params: { id: string } }>('/api/book-publications/:id/publish-chapters', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    try {
      const publication = getBookPublicationById(db, request.params.id)
      if (!publication) {
        return reply.code(404).send({ error: 'book publication not found' })
      }
    } finally {
      db.close()
    }

    try {
      const result = await runPublishJob({
        databasePath: getDatabasePath(),
        bookPublicationId: request.params.id,
      })
      return result
    } catch (error) {
      if (
        error instanceof AdapterNotConfiguredError ||
        (error instanceof Error && (error.name === 'AdapterNotConfiguredError' || /adapter is not configured/i.test(error.message)))
      ) {
        return reply.code(501).send({
          error: error instanceof Error ? error.message : 'adapter is not configured',
          publicationId: request.params.id,
          status: 'not-ready',
        })
      }
      if (error instanceof Error) {
        if (/Book publication is paused/i.test(error.message) || /Platform account must be active/i.test(error.message)) {
          return reply.code(409).send({
            error: error.message,
            publicationId: request.params.id,
            status: 'blocked',
          })
        }
        if (/missing profilePath/i.test(error.message)) {
          return reply.code(400).send({
            error: error.message,
            publicationId: request.params.id,
            status: 'invalid-account',
          })
        }
      }
      throw error
    }
  })

  app.post<{ Params: { id: string } }>('/api/book-publications/:id/verify-chapters', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    try {
      const publication = getBookPublicationById(db, request.params.id)
      if (!publication) {
        return reply.code(404).send({ error: 'book publication not found' })
      }

      return reply.code(501).send({
        publicationId: publication.id,
        status: 'not-wired',
        action: 'verify-chapters',
      })
    } finally {
      db.close()
    }
  })

  app.put<{ Params: { bookId: string }; Body: { accountId?: string } }>(
    '/api/books/:bookId',
    async (request) => {
      const { bookId } = request.params
      const { accountId } = request.body || {} as any
      const db = openDatabase(getDatabasePath())
      try {
        if (accountId !== undefined) {
          db.prepare('UPDATE books SET account_id = ? WHERE id = ?').run(accountId || null, bookId)
        }
        const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId)
        return { book }
      } finally {
        db.close()
      }
    },
  )
}
