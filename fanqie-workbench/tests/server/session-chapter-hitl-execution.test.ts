import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { syncWorkspaceBooks } from '../../src/db/repositories/books-repo.js'

const sendKeys = vi.fn(async () => {})
vi.mock('../../src/claude/terminal-runtime.js', () => ({
  createTerminalRuntime: () => {
    let sent = false
    return {
      ensureSession: async () => ({ sessionName: 'fanqie-book-book-1', created: true }),
      sendText: async () => { sent = true },
      sendKeys: async (...args: any[]) => { sent = true; sendKeys(...args) },
      capture: async () => sent ? '需要用户确认下一步\n❯\n[status]' : '',
      interrupt: async () => {},
      stop: async () => {},
      sendPermissionChoice: async () => {},
    }
  },
}))

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    on() { return this }
    start() {}
    kill() {}
  },
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-hitl-'))
  return resolve(dir, name)
}

const fixturesNovels = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/novels')

describe('chapter session human-in-the-loop execution', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.restoreAllMocks()
    sendKeys.mockReset()
  })

  it('continues a waiting chapter session by sending option selection to tmux', async () => {
    const databasePath = await createTempDatabasePath('chapter-hitl.sqlite')
    await syncWorkspaceBooks({ novelsRoot: fixturesNovels, databasePath })
    process.env.WORKBENCH_DB = databasePath

    const { openDatabase } = await import('../../src/db/client.js')
    const { createSession, updateSessionPendingQuestion, updateSessionStatus } = await import('../../src/db/repositories/sessions-repo.js')
    const db = openDatabase(databasePath)
    let chapter = db.prepare('SELECT id, book_id FROM chapters ORDER BY chapter_number LIMIT 1').get() as { id: string; book_id: string } | undefined
    if (!chapter) {
      db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '测试书', '/tmp/book')
      db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)')
        .run('chapter-1', 'book-1', 1, '雾夜', '/tmp/book/第001章_雾夜.md', '待写作')
      chapter = { id: 'chapter-1', book_id: 'book-1' }
    }
    const session = createSession(db, {
      kind: 'chapter',
      bookId: chapter.book_id,
      chapterId: chapter.id,
      status: 'waiting-answer',
      currentSkill: 'chapter-pipeline',
    })
    updateSessionPendingQuestion(db, session.id, { question: '是否继续？', options: [{ label: '1. 悬疑推理' }] })
    updateSessionStatus(db, session.id, 'waiting-answer', 'chapter-pipeline')
    db.close()

    const { buildServer } = await import('../../src/server/app')
    const app = await buildServer()

    const answerResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/answer`,
      payload: { answer: '1. 悬疑推理' },
    })
    expect(answerResponse.statusCode).toBe(200)
    expect(sendKeys).toHaveBeenCalledWith({ bookId: chapter.book_id, keys: ['Enter'] })

    const finalResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })
    const finalSession = JSON.parse(finalResponse.body).session
    expect(finalSession.pendingQuestionJson).toBeNull()

    await app.close()
  })
})
