import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildServer } from '../../src/server/app'

vi.mock('../../src/claude/claude-executor.js', () => ({
  executeClaudePrompt: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-tasks-route-'))
  return resolve(dir, name)
}

describe('tasks route', () => {
  it('accepts a draft-chapter request', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('tasks-route.sqlite')
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { type: 'draft-chapter', prompt: 'Draft chapter 1' }
    })

    expect(response.statusCode).toBe(202)
    const body = JSON.parse(response.body)
    expect(body.taskId).toBeDefined()
    expect(body.status).toBe('running')
    await app.close()
    delete process.env.WORKBENCH_DB
  })
})
