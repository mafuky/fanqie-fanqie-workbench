import type { FastifyInstance } from 'fastify'
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, relative, sep, extname, dirname } from 'node:path'
import { openDatabase } from '../../db/client.js'
import { resolveInsideRoot } from '../../agentic/tools/sandbox.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const TEXT_WRITABLE_EXTS = new Set(['.md', '.txt', '.json'])
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export type AssetNodeType = 'dir' | 'text' | 'image'
export interface AssetNode {
  path: string
  name: string
  type: AssetNodeType
  children?: AssetNode[]
}

function classify(name: string): 'text' | 'image' {
  const ext = extname(name).toLowerCase()
  return IMAGE_EXTS.has(ext) ? 'image' : 'text'
}

function buildTree(dir: string, bookRoot: string): AssetNode[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const nodes: AssetNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    const rel = relative(bookRoot, full).split(sep).join('/')
    if (entry.isDirectory()) {
      nodes.push({ path: rel, name: entry.name, type: 'dir', children: buildTree(full, bookRoot) })
    } else {
      nodes.push({ path: rel, name: entry.name, type: classify(entry.name) })
    }
  }
  nodes.sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1
    if (a.type !== 'dir' && b.type === 'dir') return 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

function getBookRoot(bookId: string): string | undefined {
  const db = openDatabase(getDatabasePath())
  try {
    const book = db.prepare('SELECT root_path FROM books WHERE id = ?').get(bookId) as
      | { root_path: string }
      | undefined
    return book?.root_path
  } finally {
    db.close()
  }
}

export async function registerBookAssetsRoutes(app: FastifyInstance) {
  app.get<{ Params: { bookId: string } }>(
    '/api/books/:bookId/assets',
    async (request, reply) => {
      const root = getBookRoot(request.params.bookId)
      if (!root) return reply.code(404).send({ error: 'book not found' })
      const tree = existsSync(root) ? buildTree(root, root) : []
      return { tree }
    },
  )

  app.get<{ Params: { bookId: string }; Querystring: { path?: string } }>(
    '/api/books/:bookId/file',
    async (request, reply) => {
      const root = getBookRoot(request.params.bookId)
      if (!root) return reply.code(404).send({ error: 'book not found' })
      const rel = request.query.path ?? ''
      let abs: string
      try {
        abs = resolveInsideRoot(root, rel)
      } catch {
        return reply.code(400).send({ error: 'invalid path' })
      }
      if (!existsSync(abs)) return reply.code(404).send({ error: 'file not found' })
      const ext = extname(abs).toLowerCase()
      if (MIME[ext]) {
        reply.header('content-type', MIME[ext])
        return reply.send(readFileSync(abs))
      }
      return { path: rel, content: readFileSync(abs, 'utf8') }
    },
  )

  app.put<{ Params: { bookId: string }; Body: { path?: string; content?: string } }>(
    '/api/books/:bookId/file',
    async (request, reply) => {
      const root = getBookRoot(request.params.bookId)
      if (!root) return reply.code(404).send({ error: 'book not found' })
      const rel = request.body?.path ?? ''
      const content = request.body?.content
      if (typeof content !== 'string') return reply.code(400).send({ error: 'content is required' })
      const ext = extname(rel).toLowerCase()
      if (!TEXT_WRITABLE_EXTS.has(ext)) {
        return reply.code(400).send({ error: 'only .md/.txt/.json are writable' })
      }
      let abs: string
      try {
        abs = resolveInsideRoot(root, rel)
      } catch {
        return reply.code(400).send({ error: 'invalid path' })
      }
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content, 'utf8')
      return { saved: true }
    },
  )
}
