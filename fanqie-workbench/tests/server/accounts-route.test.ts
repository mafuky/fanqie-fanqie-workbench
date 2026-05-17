import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-accounts-route-'))
  return resolve(dir, name)
}

describe('accounts route', () => {
  it('lists accounts', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('accounts-route.sqlite')
    const app = await buildServer()
    const response = await app.inject({ method: 'GET', url: '/api/accounts' })
    expect(response.statusCode).toBe(200)
    await app.close()
    delete process.env.WORKBENCH_DB
  })

  it('creates an account', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('accounts-route-create.sqlite')
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { label: '主号' }
    })
    expect(response.statusCode).toBe(201)
    await app.close()
    delete process.env.WORKBENCH_DB
  })
})
