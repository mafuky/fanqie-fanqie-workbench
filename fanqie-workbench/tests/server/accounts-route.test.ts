import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app'

describe('accounts route', () => {
  it('lists accounts', async () => {
    const app = await buildServer()
    const response = await app.inject({ method: 'GET', url: '/api/accounts' })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('creates an account', async () => {
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { label: '主号' }
    })
    expect(response.statusCode).toBe(201)
    await app.close()
  })
})
