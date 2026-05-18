import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createBookPublication } from '../../src/db/repositories/book-publications-repo.js'
import { createPlatformAccount } from '../../src/db/repositories/platform-accounts-repo.js'
import { upsertChapterPublication } from '../../src/db/repositories/chapter-publications-repo.js'
import { AdapterNotConfiguredError } from '../../src/publish/publisher-adapter.js'
import { buildServer } from '../../src/server/app.js'

afterEach(() => {
  delete process.env.WORKBENCH_DB
  vi.useRealTimers()
})

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-book-publications-route-'))
  return resolve(dir, name)
}

function insertBook(db: ReturnType<typeof openDatabase>, id: string, title = '测试书') {
  db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run(
    id,
    title,
    `/tmp/${id}`,
  )
}

function insertChapter(
  db: ReturnType<typeof openDatabase>,
  input: { id: string; bookId: string; chapterNumber: number; title: string; stage?: string; sourcePath?: string },
) {
  db.prepare(
    'INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    input.id,
    input.bookId,
    input.chapterNumber,
    input.title,
    input.sourcePath ?? `/tmp/${input.bookId}/${input.chapterNumber}.md`,
    input.stage ?? '可发布',
  )
}

async function createBookWorkspace(bookId: string) {
  const rootDir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-book-publication-workspace-'))
  const bookDir = resolve(rootDir, bookId)
  await mkdir(bookDir, { recursive: true })
  return bookDir
}

describe('book publications routes', () => {
  it('creates and lists publication summaries for a book with account info and status counts', async () => {
    const databasePath = await createTempDatabasePath('book-publications-create-list.sqlite')
    const db = openDatabase(databasePath)
    insertBook(db, 'book-1', '雾港疑局')
    insertChapter(db, { id: 'chapter-1', bookId: 'book-1', chapterNumber: 1, title: '开端' })
    insertChapter(db, { id: 'chapter-2', bookId: 'book-1', chapterNumber: 2, title: '追踪' })
    insertChapter(db, { id: 'chapter-3', bookId: 'book-1', chapterNumber: 3, title: '回响' })

    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', account.id)
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/books/book-1/publications',
      payload: { platform: 'fanqie', platformAccountId: account.id },
    })

    expect(createResponse.statusCode).toBe(201)
    const created = JSON.parse(createResponse.body)
    expect(created).toEqual(
      expect.objectContaining({
        bookId: 'book-1',
        platform: 'fanqie',
        platformAccountId: account.id,
        status: 'draft',
        account: { id: account.id, label: '番茄主号', status: 'active' },
        chapterStatusCounts: { pending: 3, synced: 0, published: 0, failed: 0 },
        latestPublishedAt: null,
        canPublish: true,
      }),
    )
    expect(created.account).not.toHaveProperty('cookiesJson')

    const listResponse = await app.inject({ method: 'GET', url: '/api/books/book-1/publications' })
    expect(listResponse.statusCode).toBe(200)
    expect(JSON.parse(listResponse.body)).toEqual({
      publications: [expect.objectContaining({ id: created.id, account: { id: account.id, label: '番茄主号', status: 'active' } })],
    })

    await app.close()
  })

  it('returns status counts and latestPublishedAt across pending synced published and failed chapter rows', async () => {
    vi.useFakeTimers()
    const databasePath = await createTempDatabasePath('book-publications-status-summary.sqlite')
    const db = openDatabase(databasePath)
    insertBook(db, 'book-1')
    insertChapter(db, { id: 'chapter-1', bookId: 'book-1', chapterNumber: 1, title: '第一章' })
    insertChapter(db, { id: 'chapter-2', bookId: 'book-1', chapterNumber: 2, title: '第二章' })
    insertChapter(db, { id: 'chapter-3', bookId: 'book-1', chapterNumber: 3, title: '第三章' })
    insertChapter(db, { id: 'chapter-4', bookId: 'book-1', chapterNumber: 4, title: '第四章' })

    const account = createPlatformAccount(db, { platform: 'qimao', label: '七猫主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', account.id)
    const publication = createBookPublication(db, {
      bookId: 'book-1',
      platform: 'qimao',
      platformAccountId: account.id,
    })

    vi.setSystemTime(new Date('2026-05-13T09:00:00.000Z'))
    upsertChapterPublication(db, {
      chapterId: 'chapter-1',
      bookPublicationId: publication.id,
      platformChapterId: null,
      status: 'pending',
    })

    vi.setSystemTime(new Date('2026-05-13T09:10:00.000Z'))
    upsertChapterPublication(db, {
      chapterId: 'chapter-2',
      bookPublicationId: publication.id,
      platformChapterId: 'remote-2',
      status: 'synced',
    })

    vi.setSystemTime(new Date('2026-05-13T09:20:00.000Z'))
    upsertChapterPublication(db, {
      chapterId: 'chapter-3',
      bookPublicationId: publication.id,
      platformChapterId: 'remote-3',
      status: 'published',
    })

    vi.setSystemTime(new Date('2026-05-13T09:30:00.000Z'))
    upsertChapterPublication(db, {
      chapterId: 'chapter-4',
      bookPublicationId: publication.id,
      platformChapterId: 'remote-4',
      status: 'failed',
    })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({ method: 'GET', url: `/api/book-publications/${publication.id}` })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        id: publication.id,
        chapterStatusCounts: { pending: 1, synced: 1, published: 1, failed: 1 },
        latestPublishedAt: '2026-05-13T09:20:00.000Z',
        canPublish: true,
      }),
    )

    await app.close()
  })

  it('sets canPublish to false when publication is paused or account is expired', async () => {
    const databasePath = await createTempDatabasePath('book-publications-can-publish.sqlite')
    const db = openDatabase(databasePath)
    insertBook(db, 'book-1')
    insertBook(db, 'book-2')

    const pausedAccount = createPlatformAccount(db, { platform: 'fanqie', label: '暂停账号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', pausedAccount.id)
    const pausedPublication = createBookPublication(db, {
      bookId: 'book-1',
      platform: 'fanqie',
      platformAccountId: pausedAccount.id,
    })
    db.prepare('UPDATE book_publications SET status = ? WHERE id = ?').run('paused', pausedPublication.id)

    const expiredAccount = createPlatformAccount(db, { platform: 'qimao', label: '过期账号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('expired', expiredAccount.id)
    const expiredPublication = createBookPublication(db, {
      bookId: 'book-2',
      platform: 'qimao',
      platformAccountId: expiredAccount.id,
    })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const pausedResponse = await app.inject({ method: 'GET', url: `/api/book-publications/${pausedPublication.id}` })
    expect(pausedResponse.statusCode).toBe(200)
    expect(JSON.parse(pausedResponse.body).canPublish).toBe(false)

    const expiredResponse = await app.inject({ method: 'GET', url: `/api/book-publications/${expiredPublication.id}` })
    expect(expiredResponse.statusCode).toBe(200)
    expect(JSON.parse(expiredResponse.body).canPublish).toBe(false)

    await app.close()
  })

  it('returns 404 for missing publication detail and chapter-oriented publication actions', async () => {
    const databasePath = await createTempDatabasePath('book-publications-missing-routes.sqlite')
    const app = await buildServer()
    process.env.WORKBENCH_DB = databasePath

    const detailResponse = await app.inject({ method: 'GET', url: '/api/book-publications/missing-publication' })
    expect(detailResponse.statusCode).toBe(404)
    expect(JSON.parse(detailResponse.body)).toEqual({ error: 'book publication not found' })

    const chaptersResponse = await app.inject({ method: 'GET', url: '/api/book-publications/missing-publication/chapters' })
    expect(chaptersResponse.statusCode).toBe(404)
    expect(JSON.parse(chaptersResponse.body)).toEqual({ error: 'book publication not found' })

    const publishResponse = await app.inject({ method: 'POST', url: '/api/book-publications/missing-publication/publish-chapters' })
    expect(publishResponse.statusCode).toBe(404)
    expect(JSON.parse(publishResponse.body)).toEqual({ error: 'book publication not found' })

    const verifyResponse = await app.inject({ method: 'POST', url: '/api/book-publications/missing-publication/verify-chapters' })
    expect(verifyResponse.statusCode).toBe(404)
    expect(JSON.parse(verifyResponse.body)).toEqual({ error: 'book publication not found' })

    await app.close()
  })

  it('returns 404 for missing book or account and 400 for invalid create payloads', async () => {
    const databasePath = await createTempDatabasePath('book-publications-create-errors.sqlite')
    const db = openDatabase(databasePath)
    insertBook(db, 'book-1')
    const fanqieAccount = createPlatformAccount(db, { platform: 'fanqie', label: '番茄账号' })
    const qimaoAccount = createPlatformAccount(db, { platform: 'qimao', label: '七猫账号' })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const blankPlatform = await app.inject({
      method: 'POST',
      url: '/api/books/book-1/publications',
      payload: { platform: '   ', platformAccountId: fanqieAccount.id },
    })
    expect(blankPlatform.statusCode).toBe(400)

    const missingBook = await app.inject({
      method: 'POST',
      url: '/api/books/missing-book/publications',
      payload: { platform: 'fanqie', platformAccountId: fanqieAccount.id },
    })
    expect(missingBook.statusCode).toBe(404)

    const missingAccount = await app.inject({
      method: 'POST',
      url: '/api/books/book-1/publications',
      payload: { platform: 'fanqie', platformAccountId: 'missing-account' },
    })
    expect(missingAccount.statusCode).toBe(404)

    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/books/book-1/publications',
      payload: { platform: 'fanqie', platformAccountId: qimaoAccount.id },
    })
    expect(mismatch.statusCode).toBe(400)

    const created = await app.inject({
      method: 'POST',
      url: '/api/books/book-1/publications',
      payload: { platform: 'fanqie', platformAccountId: fanqieAccount.id },
    })
    expect(created.statusCode).toBe(201)

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/books/book-1/publications',
      payload: { platform: 'fanqie', platformAccountId: fanqieAccount.id },
    })
    expect(duplicate.statusCode).toBe(400)

    await app.close()
  })

  it('gets and patches a book publication summary', async () => {
    const databasePath = await createTempDatabasePath('book-publications-get-patch.sqlite')
    const db = openDatabase(databasePath)
    insertBook(db, 'book-1')

    const originalAccount = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', originalAccount.id)
    const nextAccount = createPlatformAccount(db, { platform: 'fanqie', label: '番茄副号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', nextAccount.id)

    const publication = createBookPublication(db, {
      bookId: 'book-1',
      platform: 'fanqie',
      platformAccountId: originalAccount.id,
    })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const getResponse = await app.inject({ method: 'GET', url: `/api/book-publications/${publication.id}` })
    expect(getResponse.statusCode).toBe(200)
    expect(JSON.parse(getResponse.body)).toEqual(
      expect.objectContaining({
        id: publication.id,
        platformAccountId: originalAccount.id,
        platformBookId: null,
        status: 'draft',
      }),
    )

    const beforePatch = JSON.parse(getResponse.body).updatedAt
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/book-publications/${publication.id}`,
      payload: {
        platformAccountId: nextAccount.id,
        platformBookId: 'fanqie-book-123',
        status: 'bound',
      },
    })

    expect(patchResponse.statusCode).toBe(200)
    const patched = JSON.parse(patchResponse.body)
    expect(patched).toEqual(
      expect.objectContaining({
        id: publication.id,
        platformAccountId: nextAccount.id,
        platformBookId: 'fanqie-book-123',
        status: 'bound',
        account: { id: nextAccount.id, label: '番茄副号', status: 'active' },
      }),
    )
    expect(new Date(patched.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(beforePatch).getTime())

    await app.close()
  })

  it('rejects extra patch fields and invalid status without partial writes', async () => {
    const databasePath = await createTempDatabasePath('book-publications-invalid-patch.sqlite')
    const db = openDatabase(databasePath)
    insertBook(db, 'book-1')
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    const publication = createBookPublication(db, {
      bookId: 'book-1',
      platform: 'fanqie',
      platformAccountId: account.id,
    })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const extraFieldResponse = await app.inject({
      method: 'PATCH',
      url: `/api/book-publications/${publication.id}`,
      payload: { platformBookId: 'should-not-save', ignored: true },
    })
    expect(extraFieldResponse.statusCode).toBe(400)

    const invalidStatusResponse = await app.inject({
      method: 'PATCH',
      url: `/api/book-publications/${publication.id}`,
      payload: { platformBookId: 'still-should-not-save', status: 'broken' },
    })
    expect(invalidStatusResponse.statusCode).toBe(400)

    const getResponse = await app.inject({ method: 'GET', url: `/api/book-publications/${publication.id}` })
    expect(getResponse.statusCode).toBe(200)
    expect(JSON.parse(getResponse.body)).toEqual(
      expect.objectContaining({
        platformBookId: null,
        status: 'draft',
        platformAccountId: account.id,
      }),
    )

    await app.close()
  })

  it('rejects bound status without a final platformBookId and avoids partial writes', async () => {
    const databasePath = await createTempDatabasePath('book-publications-bound-invariants.sqlite')
    const db = openDatabase(databasePath)
    insertBook(db, 'book-1')
    insertBook(db, 'book-2')
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    const draftPublication = createBookPublication(db, {
      bookId: 'book-1',
      platform: 'fanqie',
      platformAccountId: account.id,
    })
    const boundPublication = createBookPublication(db, {
      bookId: 'book-2',
      platform: 'fanqie',
      platformAccountId: account.id,
    })
    db.prepare('UPDATE book_publications SET platform_book_id = ?, status = ? WHERE id = ?').run('bound-book-2', 'bound', boundPublication.id)
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const missingPlatformBookIdResponse = await app.inject({
      method: 'PATCH',
      url: `/api/book-publications/${draftPublication.id}`,
      payload: { status: 'bound' },
    })
    expect(missingPlatformBookIdResponse.statusCode).toBe(400)
    expect(JSON.parse(missingPlatformBookIdResponse.body)).toEqual({
      error: 'status bound requires a non-empty platformBookId',
    })

    const explicitNullPlatformBookIdResponse = await app.inject({
      method: 'PATCH',
      url: `/api/book-publications/${draftPublication.id}`,
      payload: { status: 'bound', platformBookId: null },
    })
    expect(explicitNullPlatformBookIdResponse.statusCode).toBe(400)
    expect(JSON.parse(explicitNullPlatformBookIdResponse.body)).toEqual({
      error: 'status bound requires a non-empty platformBookId',
    })

    const clearWhileBoundResponse = await app.inject({
      method: 'PATCH',
      url: `/api/book-publications/${boundPublication.id}`,
      payload: { platformBookId: null },
    })
    expect(clearWhileBoundResponse.statusCode).toBe(400)
    expect(JSON.parse(clearWhileBoundResponse.body)).toEqual({
      error: 'status bound requires a non-empty platformBookId',
    })

    const draftGetResponse = await app.inject({ method: 'GET', url: `/api/book-publications/${draftPublication.id}` })
    expect(draftGetResponse.statusCode).toBe(200)
    expect(JSON.parse(draftGetResponse.body)).toEqual(
      expect.objectContaining({
        platformBookId: null,
        status: 'draft',
        platformAccountId: account.id,
      }),
    )

    const boundGetResponse = await app.inject({ method: 'GET', url: `/api/book-publications/${boundPublication.id}` })
    expect(boundGetResponse.statusCode).toBe(200)
    expect(JSON.parse(boundGetResponse.body)).toEqual(
      expect.objectContaining({
        platformBookId: 'bound-book-2',
        status: 'bound',
        platformAccountId: account.id,
      }),
    )

    await app.close()
  })

  it('rejects patching to an account on a different platform', async () => {
    const databasePath = await createTempDatabasePath('book-publications-patch-platform-mismatch.sqlite')
    const db = openDatabase(databasePath)
    insertBook(db, 'book-1')
    const fanqieAccount = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    const qimaoAccount = createPlatformAccount(db, { platform: 'qimao', label: '七猫主号' })
    const publication = createBookPublication(db, {
      bookId: 'book-1',
      platform: 'fanqie',
      platformAccountId: fanqieAccount.id,
    })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/book-publications/${publication.id}`,
      payload: { platformAccountId: qimaoAccount.id },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('returns chapter publication rows for a publication target', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z'))

    const databasePath = await createTempDatabasePath('book-publications-chapters.sqlite')
    const db = openDatabase(databasePath)
    insertBook(db, 'book-1')
    insertChapter(db, { id: 'chapter-1', bookId: 'book-1', chapterNumber: 1, title: '第一章' })
    insertChapter(db, { id: 'chapter-2', bookId: 'book-1', chapterNumber: 2, title: '第二章' })
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    const publication = createBookPublication(db, {
      bookId: 'book-1',
      platform: 'fanqie',
      platformAccountId: account.id,
    })

    upsertChapterPublication(db, {
      chapterId: 'chapter-1',
      bookPublicationId: publication.id,
      platformChapterId: 'remote-1',
      status: 'synced',
    })

    vi.setSystemTime(new Date('2026-05-13T12:05:00.000Z'))
    upsertChapterPublication(db, {
      chapterId: 'chapter-2',
      bookPublicationId: publication.id,
      platformChapterId: 'remote-2',
      status: 'published',
    })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({ method: 'GET', url: `/api/book-publications/${publication.id}/chapters` })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      chapters: [
        expect.objectContaining({ chapterId: 'chapter-1', status: 'synced', platformChapterId: 'remote-1', lastPublishedAt: null }),
        expect.objectContaining({ chapterId: 'chapter-2', status: 'published', platformChapterId: 'remote-2', lastPublishedAt: '2026-05-13T12:05:00.000Z' }),
      ],
    })

    await app.close()
  })

  it('returns a clear 501 response from the real runner path when adapter capabilities are not configured', async () => {
    const databasePath = await createTempDatabasePath('book-publications-action-stubs.sqlite')
    const workspace = await createBookWorkspace('book-1')
    const chapterPath = resolve(workspace, '001.md')
    await writeFile(chapterPath, '# 第1章：开端\n\n第一章正文')

    const db = openDatabase(databasePath)
    insertBook(db, 'book-1')
    db.prepare('UPDATE books SET root_path = ? WHERE id = ?').run(workspace, 'book-1')
    insertChapter(db, {
      id: 'chapter-1',
      bookId: 'book-1',
      chapterNumber: 1,
      title: '开端',
      sourcePath: chapterPath,
    })
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', account.id)
    const publication = createBookPublication(db, {
      bookId: 'book-1',
      platform: 'fanqie',
      platformAccountId: account.id,
    })
    db.close()

    const page = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => 'https://author.fanqie.com/creator/home'),
    }
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

    const accountSessionModule = await import('../../src/publish/account-session.js')
    const registryModule = await import('../../src/publish/platform-registry.js')
    vi.spyOn(accountSessionModule, 'loadPublishContext').mockResolvedValue(context as never)
    vi.spyOn(registryModule, 'getPublishPlatformAdapter').mockReturnValue(adapter as never)

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const publishResponse = await app.inject({ method: 'POST', url: `/api/book-publications/${publication.id}/publish-chapters` })
    expect(publishResponse.statusCode).toBe(501)
    expect(JSON.parse(publishResponse.body)).toEqual({
      error: 'fanqie adapter is not configured for bindBook',
      publicationId: publication.id,
      status: 'not-ready',
    })

    const verifyResponse = await app.inject({ method: 'POST', url: `/api/book-publications/${publication.id}/verify-chapters` })
    expect(verifyResponse.statusCode).toBe(501)
    expect(JSON.parse(verifyResponse.body)).toEqual({
      publicationId: publication.id,
      status: 'not-wired',
      action: 'verify-chapters',
    })

    await app.close()
  })

  it('returns clear 4xx responses for blocked publish states from the real runner path', async () => {
    const databasePath = await createTempDatabasePath('book-publications-publish-blocked-states.sqlite')
    const pausedWorkspace = await createBookWorkspace('book-paused')
    const pausedChapterPath = resolve(pausedWorkspace, '001.md')
    await writeFile(pausedChapterPath, '# 第1章：开端\n\n第一章正文')

    const db = openDatabase(databasePath)
    insertBook(db, 'book-paused')
    db.prepare('UPDATE books SET root_path = ? WHERE id = ?').run(pausedWorkspace, 'book-paused')
    insertChapter(db, {
      id: 'chapter-paused',
      bookId: 'book-paused',
      chapterNumber: 1,
      title: '开端',
      sourcePath: pausedChapterPath,
    })
    const pausedAccount = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('active', pausedAccount.id)
    const pausedPublication = createBookPublication(db, {
      bookId: 'book-paused',
      platform: 'fanqie',
      platformAccountId: pausedAccount.id,
    })
    db.prepare('UPDATE book_publications SET status = ? WHERE id = ?').run('paused', pausedPublication.id)

    const inactiveWorkspace = await createBookWorkspace('book-inactive')
    const inactiveChapterPath = resolve(inactiveWorkspace, '001.md')
    await writeFile(inactiveChapterPath, '# 第1章：开端\n\n第一章正文')

    insertBook(db, 'book-inactive')
    db.prepare('UPDATE books SET root_path = ? WHERE id = ?').run(inactiveWorkspace, 'book-inactive')
    insertChapter(db, {
      id: 'chapter-inactive',
      bookId: 'book-inactive',
      chapterNumber: 1,
      title: '开端',
      sourcePath: inactiveChapterPath,
    })
    const inactiveAccount = createPlatformAccount(db, { platform: 'fanqie', label: '番茄待登录' })
    db.prepare('UPDATE platform_accounts SET status = ? WHERE id = ?').run('needs-login', inactiveAccount.id)
    const inactivePublication = createBookPublication(db, {
      bookId: 'book-inactive',
      platform: 'fanqie',
      platformAccountId: inactiveAccount.id,
    })

    const noProfileWorkspace = await createBookWorkspace('book-no-profile')
    const noProfileChapterPath = resolve(noProfileWorkspace, '001.md')
    await writeFile(noProfileChapterPath, '# 第1章：开端\n\n第一章正文')

    insertBook(db, 'book-no-profile')
    db.prepare('UPDATE books SET root_path = ? WHERE id = ?').run(noProfileWorkspace, 'book-no-profile')
    insertChapter(db, {
      id: 'chapter-no-profile',
      bookId: 'book-no-profile',
      chapterNumber: 1,
      title: '开端',
      sourcePath: noProfileChapterPath,
    })
    const noProfileAccount = createPlatformAccount(db, { platform: 'fanqie', label: '番茄无 profile' })
    db.prepare('UPDATE platform_accounts SET status = ?, profile_path = NULL WHERE id = ?').run('active', noProfileAccount.id)
    const noProfilePublication = createBookPublication(db, {
      bookId: 'book-no-profile',
      platform: 'fanqie',
      platformAccountId: noProfileAccount.id,
    })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const pausedResponse = await app.inject({ method: 'POST', url: `/api/book-publications/${pausedPublication.id}/publish-chapters` })
    expect(pausedResponse.statusCode).toBe(409)
    expect(JSON.parse(pausedResponse.body)).toEqual({
      error: 'Book publication is paused and cannot publish',
      publicationId: pausedPublication.id,
      status: 'blocked',
    })

    const inactiveResponse = await app.inject({ method: 'POST', url: `/api/book-publications/${inactivePublication.id}/publish-chapters` })
    expect(inactiveResponse.statusCode).toBe(409)
    expect(JSON.parse(inactiveResponse.body)).toEqual({
      error: 'Platform account must be active before publishing',
      publicationId: inactivePublication.id,
      status: 'blocked',
    })

    const noProfileResponse = await app.inject({ method: 'POST', url: `/api/book-publications/${noProfilePublication.id}/publish-chapters` })
    expect(noProfileResponse.statusCode).toBe(400)
    expect(JSON.parse(noProfileResponse.body)).toEqual({
      error: 'Platform account is missing profilePath required for publish context',
      publicationId: noProfilePublication.id,
      status: 'invalid-account',
    })

    await app.close()
  })
})
