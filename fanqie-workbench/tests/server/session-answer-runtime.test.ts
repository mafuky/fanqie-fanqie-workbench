import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { storeSessionRuntimeOptions } from '../../src/claude/session-runtime-options.js'
import { createSession, getSessionById } from '../../src/db/repositories/sessions-repo.js'

const mockWrite = vi.fn()
const mockSendKeys = vi.fn()
const mockKill = vi.fn()
const mockPtyEmitter = new EventEmitter()
const mockPtySession = {
  id: 'book-1',
  pty: {} as any,
  emitter: mockPtyEmitter,
  parser: { getBuffer: () => '' },
  status: 'idle' as const,
}

const mockManager = {
  spawn: vi.fn(async () => mockPtySession),
  kill: mockKill,
  getSession: vi.fn((bookId: string) => bookId === 'book-1' ? mockPtySession : null),
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
    sendPermissionChoice: vi.fn(async () => {}),
    capture: vi.fn(async () => '❯\n[status]'),
    interrupt: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
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
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-answer-runtime-'))
  return resolve(dir, name)
}

describe('session answer runtime routing', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.clearAllMocks()
    mockPtyEmitter.removeAllListeners()
  })

  it('sends option selection via arrow keys to tmux', async () => {
    const databasePath = await createTempDatabasePath('answer.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    const session = createSession(db, {
      kind: 'chapter',
      bookId: 'book-1',
      status: 'waiting-answer',
      currentSkill: 'chapter.continue',
      pendingQuestionJson: JSON.stringify({ question: '选金手指', options: [{ label: '1. 信息差' }, { label: '2. 苟道流' }] }),
    })
    db.close()
    process.env.WORKBENCH_DB = databasePath

    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/answer`,
      payload: { answer: '2. 苟道流' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockSendKeys).toHaveBeenCalledWith('book-1', ['Down', 'Enter'])

    const verifyDb = openDatabase(databasePath)
    const updated = getSessionById(verifyDb, session.id)
    verifyDb.close()
    expect(updated?.pendingQuestionJson).toBeNull()

    await app.close()
  })

  it('sends free text answers via sendText', async () => {
    const databasePath = await createTempDatabasePath('text-answer.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    const session = createSession(db, {
      kind: 'chapter',
      bookId: 'book-1',
      status: 'waiting-answer',
      currentSkill: 'chapter.continue',
      pendingQuestionJson: JSON.stringify({ question: '输入想法', options: [] }),
    })
    db.close()
    process.env.WORKBENCH_DB = databasePath

    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/answer`,
      payload: { answer: '悬疑推理方向' },
    })

    expect(response.statusCode).toBe(200)
    expect(mockWrite).toHaveBeenCalledWith('book-1', '悬疑推理方向\n')

    await app.close()
  })

  it('allows a web permission choice and sends keys to PTY', async () => {
    const databasePath = await createTempDatabasePath('permission.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    const session = createSession(db, {
      kind: 'chapter',
      bookId: 'book-1',
      status: 'waiting-permission',
      currentSkill: 'chapter.continue',
      contextSnapshotJson: JSON.stringify({ permissionPrompt: { kind: 'bash-permission' } }),
    })
    db.close()
    storeSessionRuntimeOptions(session.id, { runtimeBookId: 'book-1', currentSkill: 'chapter.continue' })
    process.env.WORKBENCH_DB = databasePath

    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/permission`,
      payload: { choice: 'allow-once' },
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ handled: true })
    expect(mockSendKeys).toHaveBeenCalledWith('book-1', ['Enter'])

    const verifyDb = openDatabase(databasePath)
    const updated = getSessionById(verifyDb, session.id)
    verifyDb.close()
    expect(updated?.status).toBe('running')

    await app.close()
  })

  it('marks sessions failed when interrupted', async () => {
    const databasePath = await createTempDatabasePath('interrupt.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    const session = createSession(db, {
      kind: 'chapter',
      bookId: 'book-1',
      status: 'running',
      currentSkill: 'chapter.continue',
    })
    db.close()
    process.env.WORKBENCH_DB = databasePath

    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()
    const response = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/interrupt` })

    expect(response.statusCode).toBe(200)
    expect(mockKill).toHaveBeenCalledWith('book-1')

    const verifyDb = openDatabase(databasePath)
    const updated = getSessionById(verifyDb, session.id)
    verifyDb.close()
    expect(updated?.status).toBe('failed')

    await app.close()
  })
})
