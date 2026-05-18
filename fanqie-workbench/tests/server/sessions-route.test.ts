import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-sessions-route-'))
  return resolve(dir, name)
}

describe('sessions route', () => {
  it('creates a prompt session', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('sessions-create.sqlite')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { kind: 'prompt' },
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.session.id).toBeDefined()
    expect(body.session.kind).toBe('prompt')
    expect(body.session.status).toBe('running')

    await app.close()
    delete process.env.WORKBENCH_DB
  })

  it('fetches a created session by id', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('sessions-get.sqlite')
    const app = await buildServer()

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { kind: 'chapter' },
    })

    const created = JSON.parse(createResponse.body).session

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${created.id}`,
    })

    expect(getResponse.statusCode).toBe(200)
    const fetched = JSON.parse(getResponse.body).session
    expect(fetched.id).toBe(created.id)
    expect(fetched.kind).toBe('chapter')
    expect(fetched.status).toBe('running')

    await app.close()
    delete process.env.WORKBENCH_DB
  })
})
