import type { FastifyInstance } from 'fastify'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { openDatabase } from '../../db/client.js'
import { runMarketScan } from '../../market/market-scan-runner.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

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

  app.post<{ Params: { scanId: string }; Body: { bookId?: string } }>('/api/market-scans/:scanId/bind-book', async (request, reply) => {
    const { bookId } = request.body || {}
    if (!bookId) return reply.code(400).send({ error: 'bookId is required' })

    const scans = await listMarkdownScans()
    const scan = scans.find((item) => item.id === decodeURIComponent(request.params.scanId))
    if (!scan) return reply.code(404).send({ error: 'market scan not found' })

    const db = openDatabase(getDatabasePath())
    try {
      const book = db.prepare('SELECT id, root_path FROM books WHERE id = ?').get(bookId) as { id: string; root_path: string } | undefined
      if (!book) return reply.code(404).send({ error: 'book not found' })

      const targetDir = resolve(book.root_path, '对标', '市场扫描')
      await mkdir(targetDir, { recursive: true })
      const boundPath = resolve(targetDir, basename(scan.path))
      await copyFile(scan.path, boundPath)
      return { bound: true, boundPath }
    } finally {
      db.close()
    }
  })
}
