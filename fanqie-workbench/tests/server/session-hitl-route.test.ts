import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildServer } from '../../src/server/app'

vi.mock('../../src/claude/claude-executor.js', () => {
  class MockClaudeSession {
    on() { return this }
    start() {}
    kill() {}
  }
  return {
    ClaudeSession: MockClaudeSession,
    executeClaudePrompt: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
  }
})

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-session-hitl-'))
  return resolve(dir, name)
}

describe('session human-in-the-loop route', () => {
  it('returns 404 when answering a session with no pending question', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('session-hitl.sqlite')
    const app = await buildServer()

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { kind: 'prompt' },
    })

    const created = JSON.parse(createResponse.body).session

    const answerResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${created.id}/answer`,
      payload: { answer: '悬疑推理' },
    })

    expect(answerResponse.statusCode).toBe(404)

    await app.close()
    delete process.env.WORKBENCH_DB
  })
})
