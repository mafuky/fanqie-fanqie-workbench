import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createBookPublication, getBookPublicationById } from '../../src/db/repositories/book-publications-repo.js'
import { getChapterPublicationsByBookPublicationId, upsertChapterPublication } from '../../src/db/repositories/chapter-publications-repo.js'
import { createPlatformAccount } from '../../src/db/repositories/platform-accounts-repo.js'
import { AdapterNotConfiguredError } from '../../src/publish/publisher-adapter.js'

const { getPublishPlatformAdapterMock, loadPublishContextMock } = vi.hoisted(() => ({
  getPublishPlatformAdapterMock: vi.fn(),
  loadPublishContextMock: vi.fn(),
}))

vi.mock('../../src/publish/platform-registry.js', () => ({
  getPublishPlatformAdapter: getPublishPlatformAdapterMock,
}))

vi.mock('../../src/publish/account-session.js', () => ({
  loadPublishContext: loadPublishContextMock,
}))

import { runPublishJob } from '../../src/publish/publish-runner.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-publish-runner-'))
  return resolve(dir, name)
}

async function createBookWorkspace(bookId: string) {
  const rootDir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-book-workspace-'))
  const bookDir = resolve(rootDir, bookId)
  await mkdir(bookDir, { recursive: true })
  return bookDir
}

function insertBook(db: ReturnType<typeof openDatabase>, id: string, rootPath: string, title = '测试书') {
  db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run(id, title, rootPath)
}

function insertChapter(
  db: ReturnType<typeof openDatabase>,
  input: { id: string; bookId: string; chapterNumber: number; title: string; sourcePath: string; stage?: string },
) {
  db.prepare(
    'INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(input.id, input.bookId, input.chapterNumber, input.title, input.sourcePath, input.stage ?? '可发布')
}

function createPageDouble() {
  return {
    goto: vi.fn(async () => undefined),
    url: vi.fn(() => 'https://author.fanqie.com/creator/home'),
  }
}

describe('runPublishJob', () => {
  it('binds the book, publishes 可发布 chapters, and persists publication mappings', async () => {
    const databasePath = await createTempDatabasePath('publish-runner-success.sqlite')
    const workspace = await createBookWorkspace('book-1')
    const chapter1Path = resolve(workspace, '001.md')
    const chapter2Path = resolve(workspace, '002.md')
    const chapter3Path = resolve(workspace, '003.md')
    await writeFile(chapter1Path, '# 第1章：开端\n\n第一章正文')
    await writeFile(chapter2Path, '# 第2章：追踪\n\n第二章正文')
    await writeFile(chapter3Path, '# 第3章：审稿中\n\n第三章正文')

    const db = openDatabase(databasePath)
    insertBook(db, 'book-1', workspace, '雾港疑局')
    insertChapter(db, { id: 'chapter-1', bookId: 'book-1', chapterNumber: 1, title: '开端', sourcePath: chapter1Path })
    insertChapter(db, { id: 'chapter-2', bookId: 'book-1', chapterNumber: 2, title: '追踪', sourcePath: chapter2Path })
    insertChapter(db, { id: 'chapter-3', bookId: 'book-1', chapterNumber: 3, title: '审稿中', sourcePath: chapter3Path, stage: '已审稿' })
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', account.id)
    const publication = createBookPublication(db, {
      bookId: 'book-1',
      platform: 'fanqie',
      platformAccountId: account.id,
    })
    db.close()

    const page = createPageDouble()
    const context = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    }
    const adapter = {
      platform: 'fanqie',
      openBackend: vi.fn(async () => undefined),
      ensureLoggedIn: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => []),
      bindBook: vi.fn(async () => ({ platformBookId: 'fanqie-book-1' })),
      publishChapter: vi.fn()
        .mockResolvedValueOnce({ platformChapterId: 'remote-chapter-1', status: 'published' })
        .mockResolvedValueOnce({ platformChapterId: 'remote-chapter-2', status: 'synced' }),
      verifyChapter: vi.fn(async () => false),
    }

    getPublishPlatformAdapterMock.mockReturnValue(adapter)
    loadPublishContextMock.mockResolvedValue(context)

    const result = await runPublishJob({
      databasePath,
      bookPublicationId: publication.id,
    })

    expect(result).toEqual({
      publicationId: publication.id,
      platform: 'fanqie',
      platformBookId: 'fanqie-book-1',
      attemptedChapterIds: ['chapter-1', 'chapter-2'],
      chapters: [
        { chapterId: 'chapter-1', platformChapterId: 'remote-chapter-1', status: 'published' },
        { chapterId: 'chapter-2', platformChapterId: 'remote-chapter-2', status: 'synced' },
      ],
    })

    expect(adapter.openBackend).toHaveBeenCalledWith(page)
    expect(adapter.ensureLoggedIn).toHaveBeenCalledWith(page)
    expect(adapter.bindBook).toHaveBeenCalledWith(page, {
      id: 'book-1',
      title: '雾港疑局',
      rootPath: workspace,
    })
    expect(adapter.publishChapter).toHaveBeenNthCalledWith(1, page, {
      bookPublicationId: publication.id,
      chapterId: 'chapter-1',
      platformBookId: 'fanqie-book-1',
      platformChapterId: '',
      title: '开端',
      content: '第一章正文',
    })
    expect(adapter.publishChapter).toHaveBeenNthCalledWith(2, page, {
      bookPublicationId: publication.id,
      chapterId: 'chapter-2',
      platformBookId: 'fanqie-book-1',
      platformChapterId: '',
      title: '追踪',
      content: '第二章正文',
    })
    expect(context.close).toHaveBeenCalledTimes(1)

    const verifyDb = openDatabase(databasePath)
    expect(getBookPublicationById(verifyDb, publication.id)).toEqual(
      expect.objectContaining({ platformBookId: 'fanqie-book-1', status: 'bound' }),
    )
    expect(getChapterPublicationsByBookPublicationId(verifyDb, publication.id)).toEqual([
      expect.objectContaining({ chapterId: 'chapter-1', platformChapterId: 'remote-chapter-1', status: 'published' }),
      expect.objectContaining({ chapterId: 'chapter-2', platformChapterId: 'remote-chapter-2', status: 'synced' }),
    ])
    verifyDb.close()
  })

  it('surfaces adapter capability gaps as not-configured errors without fake success', async () => {
    const databasePath = await createTempDatabasePath('publish-runner-not-configured.sqlite')
    const workspace = await createBookWorkspace('book-2')
    const chapterPath = resolve(workspace, '001.md')
    await writeFile(chapterPath, '# 第1章：开端\n\n第一章正文')

    const db = openDatabase(databasePath)
    insertBook(db, 'book-2', workspace)
    insertChapter(db, { id: 'chapter-1', bookId: 'book-2', chapterNumber: 1, title: '开端', sourcePath: chapterPath })
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', account.id)
    const publication = createBookPublication(db, {
      bookId: 'book-2',
      platform: 'fanqie',
      platformAccountId: account.id,
    })
    db.close()

    const page = createPageDouble()
    const context = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    }
    const adapter = {
      platform: 'fanqie',
      openBackend: vi.fn(async () => undefined),
      ensureLoggedIn: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => []),
      bindBook: vi.fn(async () => {
        throw new AdapterNotConfiguredError('fanqie', 'bindBook')
      }),
      publishChapter: vi.fn(),
      verifyChapter: vi.fn(async () => false),
    }

    getPublishPlatformAdapterMock.mockReturnValue(adapter)
    loadPublishContextMock.mockResolvedValue(context)

    await expect(
      runPublishJob({
        databasePath,
        bookPublicationId: publication.id,
      }),
    ).rejects.toThrow('fanqie adapter is not configured for bindBook')

    expect(context.close).toHaveBeenCalledTimes(1)

    const verifyDb = openDatabase(databasePath)
    expect(getBookPublicationById(verifyDb, publication.id)).toEqual(
      expect.objectContaining({ platformBookId: null, status: 'draft' }),
    )
    expect(getChapterPublicationsByBookPublicationId(verifyDb, publication.id)).toEqual([])
    verifyDb.close()
  })

  it('rejects paused publications and inactive accounts before reaching the adapter', async () => {
    const databasePath = await createTempDatabasePath('publish-runner-state-guards.sqlite')
    const workspace = await createBookWorkspace('book-3')
    const chapterPath = resolve(workspace, '001.md')
    await writeFile(chapterPath, '# 第1章：开端\n\n第一章正文')

    const db = openDatabase(databasePath)
    const workspaceB = await createBookWorkspace('book-3b')
    const chapterPathB = resolve(workspaceB, '001.md')
    await writeFile(chapterPathB, '# 第1章：开端\n\n第一章正文')

    insertBook(db, 'book-3', workspace)
    insertBook(db, 'book-3b', workspaceB)
    insertChapter(db, { id: 'chapter-1', bookId: 'book-3', chapterNumber: 1, title: '开端', sourcePath: chapterPath })
    insertChapter(db, { id: 'chapter-2', bookId: 'book-3b', chapterNumber: 1, title: '开端', sourcePath: chapterPathB })

    const pausedAccount = createPlatformAccount(db, { platform: 'fanqie', label: '暂停账号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', pausedAccount.id)
    const pausedPublication = createBookPublication(db, {
      bookId: 'book-3',
      platform: 'fanqie',
      platformAccountId: pausedAccount.id,
    })
    db.prepare('UPDATE book_publications SET status = ? WHERE id = ?').run('paused', pausedPublication.id)

    const inactiveAccount = createPlatformAccount(db, { platform: 'fanqie', label: '未激活账号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('needs-login', inactiveAccount.id)
    const inactivePublication = createBookPublication(db, {
      bookId: 'book-3b',
      platform: 'fanqie',
      platformAccountId: inactiveAccount.id,
    })
    db.close()

    getPublishPlatformAdapterMock.mockReturnValue({
      platform: 'fanqie',
      openBackend: vi.fn(async () => undefined),
      ensureLoggedIn: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => []),
      bindBook: vi.fn(async () => ({ platformBookId: 'fanqie-book-3' })),
      publishChapter: vi.fn(async () => ({ platformChapterId: 'remote', status: 'published' })),
      verifyChapter: vi.fn(async () => false),
    })

    await expect(runPublishJob({ databasePath, bookPublicationId: pausedPublication.id })).rejects.toThrow(
      'Book publication is paused and cannot publish',
    )
    await expect(runPublishJob({ databasePath, bookPublicationId: inactivePublication.id })).rejects.toThrow(
      'Platform account must be active before publishing',
    )
    expect(loadPublishContextMock).not.toHaveBeenCalled()
  })

  it('reuses existing chapter publication mappings when publishing again', async () => {
    const databasePath = await createTempDatabasePath('publish-runner-reuse-mapping.sqlite')
    const workspace = await createBookWorkspace('book-4')
    const chapterPath = resolve(workspace, '001.md')
    await writeFile(chapterPath, '# 第1章：开端\n\n第一章正文')

    const db = openDatabase(databasePath)
    insertBook(db, 'book-4', workspace)
    insertChapter(db, { id: 'chapter-1', bookId: 'book-4', chapterNumber: 1, title: '开端', sourcePath: chapterPath })
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', account.id)
    const publication = createBookPublication(db, {
      bookId: 'book-4',
      platform: 'fanqie',
      platformAccountId: account.id,
    })
    db.prepare('UPDATE book_publications SET platform_book_id = ?, status = ? WHERE id = ?').run('fanqie-book-4', 'bound', publication.id)
    upsertChapterPublication(db, {
      chapterId: 'chapter-1',
      bookPublicationId: publication.id,
      platformChapterId: 'remote-existing-1',
      status: 'synced',
    })
    db.close()

    const page = createPageDouble()
    const context = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    }
    const adapter = {
      platform: 'fanqie',
      openBackend: vi.fn(async () => undefined),
      ensureLoggedIn: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => []),
      bindBook: vi.fn(async () => ({ platformBookId: 'fanqie-book-4' })),
      publishChapter: vi.fn(async () => ({ platformChapterId: 'remote-existing-1', status: 'published' })),
      verifyChapter: vi.fn(async () => false),
    }

    getPublishPlatformAdapterMock.mockReturnValue(adapter)
    loadPublishContextMock.mockResolvedValue(context)

    await runPublishJob({ databasePath, bookPublicationId: publication.id })

    expect(adapter.bindBook).not.toHaveBeenCalled()
    expect(adapter.publishChapter).toHaveBeenCalledWith(page, expect.objectContaining({
      platformChapterId: 'remote-existing-1',
    }))
  })

  it('rejects reused success when adapter omits platformChapterId on an already-mapped chapter', async () => {
    const databasePath = await createTempDatabasePath('publish-runner-reuse-mapping-missing-id.sqlite')
    const workspace = await createBookWorkspace('book-4b')
    const chapterPath = resolve(workspace, '001.md')
    await writeFile(chapterPath, '# 第1章：开端\n\n第一章正文')

    const db = openDatabase(databasePath)
    insertBook(db, 'book-4b', workspace)
    insertChapter(db, { id: 'chapter-1', bookId: 'book-4b', chapterNumber: 1, title: '开端', sourcePath: chapterPath })
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', account.id)
    const publication = createBookPublication(db, {
      bookId: 'book-4b',
      platform: 'fanqie',
      platformAccountId: account.id,
    })
    db.prepare('UPDATE book_publications SET platform_book_id = ?, status = ? WHERE id = ?').run('fanqie-book-4b', 'bound', publication.id)
    upsertChapterPublication(db, {
      chapterId: 'chapter-1',
      bookPublicationId: publication.id,
      platformChapterId: 'remote-existing-1',
      status: 'synced',
    })
    db.close()

    const page = createPageDouble()
    const context = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    }
    const adapter = {
      platform: 'fanqie',
      openBackend: vi.fn(async () => undefined),
      ensureLoggedIn: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => []),
      bindBook: vi.fn(async () => ({ platformBookId: 'fanqie-book-4b' })),
      publishChapter: vi.fn(async () => ({ status: 'published' })),
      verifyChapter: vi.fn(async () => false),
    }

    getPublishPlatformAdapterMock.mockReturnValue(adapter)
    loadPublishContextMock.mockResolvedValue(context)

    await expect(runPublishJob({ databasePath, bookPublicationId: publication.id })).rejects.toThrow(
      'publishChapter must return platformChapterId for synced or published statuses',
    )
  })

  it('rejects adapter success without platformChapterId when the status requires a mapping', async () => {
    const databasePath = await createTempDatabasePath('publish-runner-missing-platform-chapter-id.sqlite')
    const workspace = await createBookWorkspace('book-5')
    const chapterPath = resolve(workspace, '001.md')
    await writeFile(chapterPath, '# 第1章：开端\n\n第一章正文')

    const db = openDatabase(databasePath)
    insertBook(db, 'book-5', workspace)
    insertChapter(db, { id: 'chapter-1', bookId: 'book-5', chapterNumber: 1, title: '开端', sourcePath: chapterPath })
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', account.id)
    const publication = createBookPublication(db, {
      bookId: 'book-5',
      platform: 'fanqie',
      platformAccountId: account.id,
    })
    db.prepare('UPDATE book_publications SET platform_book_id = ?, status = ? WHERE id = ?').run('fanqie-book-5', 'bound', publication.id)
    db.close()

    const page = createPageDouble()
    const context = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    }
    const adapter = {
      platform: 'fanqie',
      openBackend: vi.fn(async () => undefined),
      ensureLoggedIn: vi.fn(async () => undefined),
      listBooks: vi.fn(async () => []),
      bindBook: vi.fn(async () => ({ platformBookId: 'fanqie-book-5' })),
      publishChapter: vi.fn(async () => ({ status: 'published' })),
      verifyChapter: vi.fn(async () => false),
    }

    getPublishPlatformAdapterMock.mockReturnValue(adapter)
    loadPublishContextMock.mockResolvedValue(context)

    await expect(runPublishJob({ databasePath, bookPublicationId: publication.id })).rejects.toThrow(
      'publishChapter must return platformChapterId for synced or published statuses',
    )

    const verifyDb = openDatabase(databasePath)
    expect(getChapterPublicationsByBookPublicationId(verifyDb, publication.id)).toEqual([])
    verifyDb.close()
  })
})
