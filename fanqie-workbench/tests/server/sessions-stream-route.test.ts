import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-sessions-stream-'))
  return resolve(dir, name)
}

describe('sessions stream route', () => {
  it('returns 404 when session does not exist', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('sessions-stream.sqlite')
    const app = await buildServer()

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/missing-session/stream',
    })

    expect(response.statusCode).toBe(404)

    await app.close()
    delete process.env.WORKBENCH_DB
  })
})
