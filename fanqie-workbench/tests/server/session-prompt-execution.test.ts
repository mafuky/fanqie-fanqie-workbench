import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/claude/claude-executor.js', () => {
  class MockClaudeSession {
    private handlers = new Map<string, Array<(event: any) => void>>()
    on(eventName: string, handler: (event: any) => void) {
      const handlers = this.handlers.get(eventName) || []
      handlers.push(handler)
      this.handlers.set(eventName, handlers)
      return this
    }
    start() {
      queueMicrotask(() => {
        for (const handler of this.handlers.get('claude') || []) {
          handler({ type: 'text', text: '模拟写作输出' })
          handler({ type: 'done', exitCode: 0 })
        }
      })
    }
    kill() {}
  }
  return {
    ClaudeSession: MockClaudeSession,
    executeClaudePrompt: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '模拟写作输出',
      stderr: '',
    }),
  }
})

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-session-'))
  return resolve(dir, name)
}

describe('prompt session execution', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.restoreAllMocks()
  })

  it('executes prompt session and persists streamed messages', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('prompt-session.sqlite')
    const { buildServer } = await import('../../src/server/app')
    const app = await buildServer()

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'prompt',
        currentSkill: 'custom',
        prompt: '帮我开一本悬疑小说',
      },
    })

    expect(createResponse.statusCode).toBe(201)
    const session = JSON.parse(createResponse.body).session

    await new Promise((resolve) => setTimeout(resolve, 0))

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}`,
    })
    const fetched = JSON.parse(getResponse.body).session
    expect(fetched.status).toBe('succeeded')

    const streamResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/stream`,
    })
    expect(streamResponse.statusCode).toBe(200)
    expect(streamResponse.body).toContain('模拟写作输出')
    expect(streamResponse.body).toContain('event: done')

    await app.close()
  })
})
