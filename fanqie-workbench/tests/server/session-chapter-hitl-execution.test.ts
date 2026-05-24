import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { syncWorkspaceBooks } from '../../src/db/repositories/books-repo.js'

const mockSendKeys = vi.fn()
const mockWrite = vi.fn()
const mockPtyEmitter = new EventEmitter()

// Factory: creates a mock PtySession for any bookId
function makeMockPtySession(bookId: string) {
  return {
    id: bookId,
    pty: {} as any,
    emitter: mockPtyEmitter,
    parser: { getBuffer: () => '' },
    status: 'idle' as const,
  }
}

const sessionCache = new Map<string, ReturnType<typeof makeMockPtySession>>()

const mockManager = {
  spawn: vi.fn(async (bookId: string) => {
    const s = makeMockPtySession(bookId)
    sessionCache.set(bookId, s)
    return s
  }),
  kill: vi.fn(),
  getSession: vi.fn((bookId: string) => sessionCache.get(bookId) ?? makeMockPtySession(bookId)),
  write: mockWrite,
  sendKeys: mockSendKeys,
  resize: vi.fn(),
}

vi.mock('../../src/claude/pty-manager.js', () => ({
  createPtyManager: () => mockManager,
}))

vi.mock('../../src/claude/book-entry-terminal-runner.js', () => ({
  getBookEntryPtyManager: () => mockManager,
  runBookEntryTerminalSession: vi.fn(async () => {}),
}))

vi.mock('../../src/claude/terminal-runtime.js', () => ({
  createTerminalRuntime: () => ({
    ensureSession: vi.fn(async () => ({ sessionName: 'test', created: true })),
    sendText: vi.fn(async () => {}),
    sendKeys: vi.fn(async () => {}),
    capture: vi.fn(async () => '❯\n[status]'),
    interrupt: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    sendPermissionChoice: vi.fn(async () => {}),
  }),
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
    mockSendKeys.mockReset()
    mockWrite.mockReset()
    mockPtyEmitter.removeAllListeners()
    sessionCache.clear()
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
    expect(mockSendKeys).toHaveBeenCalledWith(chapter.book_id, ['Enter'])

    const finalResponse = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })
    const finalSession = JSON.parse(finalResponse.body).session
    expect(finalSession.pendingQuestionJson).toBeNull()

    await app.close()
  })
})
