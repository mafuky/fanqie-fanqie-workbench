import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app'

describe('project bootstrap', () => {
  it('builds the Fastify app', async () => {
    const app = await buildServer()
    expect(app).toBeDefined()
    await app.close()
  })
})
