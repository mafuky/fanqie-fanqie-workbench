import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    on() { return this }
    start() {}
    kill() {}
  },
}))

async function createFixture() {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-action-route-'))
  const databasePath = resolve(dir, 'workbench.sqlite')
  const db = openDatabase(databasePath)
  db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
  db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)')
    .run('chapter-1', 'book-1', 1, '雾夜失踪', '/tmp/book/正文/第001章_雾夜失踪.md', '待写作')
  db.close()
  process.env.WORKBENCH_DB = databasePath
  return { databasePath }
}

describe('action route', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.clearAllMocks()
  })

  it('creates a chapter action session and starts terminal runner', async () => {
    await createFixture()
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { actionKey: 'chapter.continue', bookId: 'book-1', chapterId: 'chapter-1' },
    })
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(201)
    expect(body.session).toMatchObject({ kind: 'chapter', bookId: 'book-1', chapterId: 'chapter-1', currentSkill: 'chapter.continue' })

    await app.close()
  })

  it('returns 400 for unknown action', async () => {
    await createFixture()
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { actionKey: 'unknown.action', bookId: 'book-1', chapterId: 'chapter-1' },
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body).error).toContain('Unknown action')

    await app.close()
  })
})
