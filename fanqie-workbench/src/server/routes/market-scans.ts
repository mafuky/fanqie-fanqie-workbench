import type { FastifyInstance } from 'fastify'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runMarketScan } from '../../market/market-scan-runner.js'

function getWorkspaceRoot() {
  return process.env.WORKBENCH_ROOT || resolve(import.meta.dirname, '..', '..', '..', '..')
}

function getScanRoot() {
  return resolve(getWorkspaceRoot(), 'fanqie-workbench', 'data', 'market-scans')
}

async function listMarkdownScans() {
  const root = getScanRoot()
  const dates = await readdir(root).catch(() => [])
  const scans: Array<{ id: string; date: string; fileName: string; path: string }> = []
  for (const date of dates) {
    const dateDir = resolve(root, date)
    const files = await readdir(dateDir).catch(() => [])
    for (const fileName of files.filter((file) => file.endsWith('.md'))) {
      scans.push({ id: `${date}/${fileName}`, date, fileName, path: resolve(dateDir, fileName) })
    }
  }
  return scans.sort((a, b) => b.id.localeCompare(a.id))
}

export async function registerMarketScanRoutes(app: FastifyInstance) {
  app.post<{ Body: { preset?: string } }>('/api/market-scans', async (request, reply) => {
    if (!request.body?.preset) return reply.code(400).send({ error: 'preset is required' })
    try {
      return await runMarketScan({ preset: request.body.preset, workspaceRoot: getWorkspaceRoot() })
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/market-scans', async () => ({ scans: await listMarkdownScans() }))

  app.get<{ Params: { scanId: string } }>('/api/market-scans/:scanId/content', async (request, reply) => {
    const scans = await listMarkdownScans()
    const scan = scans.find((item) => item.id === decodeURIComponent(request.params.scanId))
    if (!scan) return reply.code(404).send({ error: 'market scan not found' })
    try {
      const content = await readFile(scan.path, 'utf8')
      return { fileName: scan.fileName, content }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: 'market scan not found' })
      }
      throw err
    }
  })
}
