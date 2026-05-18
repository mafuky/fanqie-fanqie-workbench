import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createSession } from '../../src/db/repositories/sessions-repo.js'
import { buildServer } from '../../src/server/app.js'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-books-route-'))
  return resolve(dir, name)
}

describe('books route', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('returns book summary with stage counts and active session', async () => {
    const databasePath = await createTempDatabasePath('books-route.sqlite')
    const db = openDatabase(databasePath)

    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run(
      'book-1',
      '雾港疑局',
      '/tmp/novels/book-1',
    )

    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'chapter-1',
      'book-1',
      1,
      '开端',
      '/tmp/novels/book-1/chapters/001.md',
      '待写作',
    )
    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'chapter-2',
      'book-1',
      2,
      '追踪',
      '/tmp/novels/book-1/chapters/002.md',
      '可发布',
    )
    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'chapter-3',
      'book-1',
      3,
      '回响',
      '/tmp/novels/book-1/chapters/003.md',
      '已发布',
    )

    const activeSession = createSession(db, {
      kind: 'chapter',
      bookId: 'book-1',
      chapterId: 'chapter-2',
      status: 'running',
      currentSkill: 'chapter-pipeline',
    })

    db.close()
    process.env.WORKBENCH_DB = databasePath

    const app = await buildServer()
    const response = await app.inject({ method: 'GET', url: '/api/books/book-1' })
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(200)
    expect(body.summary).toEqual({
      totalChapters: 3,
      byStage: {
        '待写作': 1,
        '已初稿': 0,
        '已去AI': 0,
        '已审稿': 0,
        '可发布': 1,
        '发布中': 0,
        '已发布': 1,
      },
      publishableCount: 1,
      activeSessionId: activeSession.id,
      activeChapterId: 'chapter-2',
    })

    await app.close()
  })

  it('lists sessions for a specific book ordered by newest update', async () => {
    const databasePath = await createTempDatabasePath('book-sessions.sqlite')
    const db = openDatabase(databasePath)

    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run(
      'book-1',
      '雾港疑局',
      '/tmp/novels/book-1',
    )
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run(
      'book-2',
      '灰塔回声',
      '/tmp/novels/book-2',
    )

    const first = createSession(db, {
      kind: 'prompt',
      bookId: 'book-1',
      status: 'succeeded',
      currentSkill: 'chapter-pipeline',
    })
    const second = createSession(db, {
      kind: 'prompt',
      bookId: 'book-1',
      status: 'running',
      currentSkill: 'story',
    })
    createSession(db, {
      kind: 'prompt',
      bookId: 'book-2',
      status: 'running',
      currentSkill: 'chapter-pipeline',
    })

    db.close()
    process.env.WORKBENCH_DB = databasePath

    const app = await buildServer()
    const response = await app.inject({ method: 'GET', url: '/api/books/book-1/sessions' })
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(200)
    expect(body.sessions).toHaveLength(2)
    expect(new Set(body.sessions.map((session: { id: string }) => session.id))).toEqual(new Set([second.id, first.id]))
    expect(body.sessions.every((session: { bookId: string | null }) => session.bookId === 'book-1')).toBe(true)

    await app.close()
  })
})
