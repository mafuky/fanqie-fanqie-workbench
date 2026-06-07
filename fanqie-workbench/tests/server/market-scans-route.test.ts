import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

vi.mock('../../src/market/market-scan-runner.js', () => ({
  runMarketScan: vi.fn(async () => ({
    status: 'succeeded',
    preset: 'fanqie-female-reading',
    outputDir: '/tmp/scans/2026-05-18',
    outputFiles: ['/tmp/scans/2026-05-18/fanqie-female-reading.md'],
  })),
}))

async function createFixture(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), `fanqie-market-api-${name}-`))
  const databasePath = resolve(dir, 'workbench.sqlite')
  const bookRoot = resolve(dir, 'book')
  await mkdir(resolve(bookRoot, '对标', '市场扫描'), { recursive: true })
  const scanDir = resolve(dir, 'fanqie-workbench', 'data', 'market-scans', '2026-05-18')
  await mkdir(scanDir, { recursive: true })
  const scanFile = resolve(scanDir, 'fanqie-female-reading.md')
  await writeFile(scanFile, '# 番茄女频阅读榜\n', 'utf8')

  const db = openDatabase(databasePath)
  db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', bookRoot)
  db.close()

  process.env.WORKBENCH_DB = databasePath
  process.env.WORKBENCH_ROOT = dir
  return { dir, scanFile, bookRoot }
}

describe('market scans route', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    delete process.env.WORKBENCH_ROOT
    vi.clearAllMocks()
  })

  it('runs a market scan preset', async () => {
    await createFixture('post')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({ method: 'POST', url: '/api/market-scans', payload: { preset: 'fanqie-female-reading' } })
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(200)
    expect(body.status).toBe('succeeded')
    expect(body.preset).toBe('fanqie-female-reading')
    expect(body.outputFiles).toEqual(expect.arrayContaining(['/tmp/scans/2026-05-18/fanqie-female-reading.md']))

    await app.close()
  })

  it('lists existing markdown scan results', async () => {
    const { dir } = await createFixture('list')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({ method: 'GET', url: '/api/market-scans' })
    const body = JSON.parse(response.body)

    expect(response.statusCode).toBe(200)
    expect(body.scans).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.stringContaining('2026-05-18'), fileName: 'fanqie-female-reading.md' }),
    ]))
    expect(body.scans[0].path).toContain(resolve(dir, 'fanqie-workbench', 'data', 'market-scans'))

    await app.close()
  })

  it('returns markdown content for a valid scanId', async () => {
    await createFixture('content')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'GET',
      url: '/api/market-scans/2026-05-18%2Ffanqie-female-reading.md/content',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.fileName).toBe('fanqie-female-reading.md')
    expect(body.content).toContain('番茄女频阅读榜')

    await app.close()
  })

  it('returns 404 for an unknown scanId', async () => {
    await createFixture('content-404')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'GET',
      url: '/api/market-scans/2026-05-18%2Fdoes-not-exist.md/content',
    })

    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('does not serve files outside the scan root (path traversal)', async () => {
    await createFixture('content-traversal')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'GET',
      url: '/api/market-scans/' + encodeURIComponent('../../../../etc/passwd') + '/content',
    })

    expect(response.statusCode).toBe(404)
    await app.close()
  })
})
