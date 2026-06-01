import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { schemaSql } from '../../src/db/schema.js'
import { registerBookRoutes } from '../../src/server/routes/books.js'

let app: FastifyInstance
let tmp: string
let dbPath: string
let prevDb: string | undefined
let prevImgKey: string | undefined
let prevOpenAiKey: string | undefined

beforeEach(async () => {
  prevDb = process.env.WORKBENCH_DB
  prevImgKey = process.env.IMAGE_API_KEY
  prevOpenAiKey = process.env.OPENAI_API_KEY
  tmp = mkdtempSync(join(tmpdir(), 'books-cover-'))
  dbPath = join(tmp, 'test.sqlite')
  process.env.WORKBENCH_DB = dbPath
  const db = new Database(dbPath)
  db.exec(schemaSql)
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run('real-1', '雾港疑局', '/novels/雾港疑局')
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run('pending-1', '占位', 'pending:pending-1')
  db.close()
  app = Fastify()
  await registerBookRoutes(app)
  await app.ready()
})

afterEach(async () => {
  await app?.close()
  rmSync(tmp, { recursive: true, force: true })
  if (prevDb === undefined) delete process.env.WORKBENCH_DB
  else process.env.WORKBENCH_DB = prevDb
  if (prevImgKey === undefined) delete process.env.IMAGE_API_KEY
  else process.env.IMAGE_API_KEY = prevImgKey
  if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = prevOpenAiKey
})

describe('POST /api/books/:bookId/cover', () => {
  it('returns 409 for a book that is still pending', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/books/pending-1/cover' })
    expect(res.statusCode).toBe(409)
  })

  it('returns 404 for an unknown book', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/books/nope/cover' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 503 when no image API key is configured', async () => {
    delete process.env.IMAGE_API_KEY
    delete process.env.OPENAI_API_KEY
    const res = await app.inject({ method: 'POST', url: '/api/books/real-1/cover' })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toMatch(/image API key/i)
  })
})
