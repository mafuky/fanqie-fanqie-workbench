import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/claude/claude-executor.js', () => ({
  ClaudeSession: class MockClaudeSession {
    on() { return this }
    start() {}
    kill() {}
  },
}))

let mockCaptureText = '开书中…'
vi.mock('../../src/claude/terminal-runtime.js', () => ({
  createTerminalRuntime: () => {
    let sent = false
    return {
      ensureSession: async () => ({ sessionName: 'fanqie-book-book-entry', created: true }),
      sendText: async () => { sent = true },
      capture: async () => sent ? mockCaptureText : '',
      interrupt: async () => {},
      stop: async () => {},
    }
  },
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-book-create-'))
  return resolve(dir, name)
}

describe('book creation session', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    mockCaptureText = '开书中…'
  })

  it('creates a book-entry session and runs it via terminal runtime', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('book-create.sqlite')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'prompt',
        currentSkill: 'book-entry',
        idea: '现代悬疑复仇文',
      },
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.session.currentSkill).toBe('book-entry')
    expect(body.session.id).toBeTruthy()

    await app.close()
  })

  it('allows manual completion of a book-entry session with auto-scan', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('book-complete.sqlite')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'prompt',
        currentSkill: 'book-entry',
        idea: '都市复仇',
      },
    })
    const sessionId = JSON.parse(createResponse.body).session.id

    await new Promise((resolve) => setTimeout(resolve, 50))

    const completeResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/complete`,
    })
    expect(completeResponse.statusCode).toBe(200)
    const completeBody = JSON.parse(completeResponse.body)
    expect(completeBody.completed).toBe(true)

    const sessionResponse = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })
    expect(JSON.parse(sessionResponse.body).session.status).toBe('succeeded')

    await app.close()
  })
})
