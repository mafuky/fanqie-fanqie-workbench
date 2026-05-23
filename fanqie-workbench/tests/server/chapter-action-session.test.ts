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

vi.mock('../../src/claude/terminal-runtime.js', () => ({
  createTerminalRuntime: () => {
    let sent = false
    return {
      ensureSession: async () => ({ sessionName: 'fanqie-book-book-1', created: true }),
      sendText: async () => { sent = true },
      capture: async () => sent ? '已完成润色\n❯\n[status]' : '',
      interrupt: async () => {},
      stop: async () => {},
    }
  },
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-action-'))
  return resolve(dir, name)
}

describe('chapter action session', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
  })

  it('creates a chapter action session for polish and streams its action output', async () => {
    const databasePath = await createTempDatabasePath('chapter-action.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book-1')
    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'chapter-1',
      'book-1',
      1,
      '雾夜失踪',
      '/tmp/book-1/001.md',
      '已初稿',
    )
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'chapter',
        bookId: 'book-1',
        chapterId: 'chapter-1',
        currentSkill: 'chapter-polish',
      },
    })

    expect(response.statusCode).toBe(201)

    const body = JSON.parse(response.body)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const sessionRes = await app.inject({ method: 'GET', url: `/api/sessions/${body.session.id}` })
      if (JSON.parse(sessionRes.body).session.status === 'succeeded') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const stream = await app.inject({ method: 'GET', url: `/api/sessions/${body.session.id}/stream` })
    expect(stream.body).toContain('已完成润色')

    await app.close()
  })
})
