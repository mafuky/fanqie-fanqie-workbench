import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app'

describe('task stream', () => {
  it('POST /api/tasks returns taskId when prompt provided', async () => {
    process.env.WORKBENCH_DB = ':memory:'
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { prompt: 'echo hello' }
    })

    expect(response.statusCode).toBe(202)
    const body = JSON.parse(response.body)
    expect(body.taskId).toBeDefined()
    expect(body.status).toBe('running')
    await app.close()
    delete process.env.WORKBENCH_DB
  })

  it('POST /api/tasks returns 400 without prompt', async () => {
    process.env.WORKBENCH_DB = ':memory:'
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {}
    })

    expect(response.statusCode).toBe(400)
    await app.close()
    delete process.env.WORKBENCH_DB
  })
})
