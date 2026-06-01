import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { schemaSql } from '../../src/db/schema.js'
import { registerBookRoutes } from '../../src/server/routes/books.js'

let app: FastifyInstance
let tmp: string
let bookDir: string
let dbPath: string
let prevDb: string | undefined
let prevGptImgKey: string | undefined
let prevImgKey: string | undefined
let prevOpenAiKey: string | undefined

beforeEach(async () => {
  prevDb = process.env.WORKBENCH_DB
  prevGptImgKey = process.env.GPT_IMAGE_API_KEY
  prevImgKey = process.env.IMAGE_API_KEY
  prevOpenAiKey = process.env.OPENAI_API_KEY
  tmp = mkdtempSync(join(tmpdir(), 'books-cover-'))
  dbPath = join(tmp, 'test.sqlite')
  process.env.WORKBENCH_DB = dbPath
  bookDir = join(tmp, 'book-fs')
  mkdirSync(bookDir)
  const db = new Database(dbPath)
  db.exec(schemaSql)
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run('real-1', '雾港疑局', '/novels/雾港疑局')
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run('pending-1', '占位', 'pending:pending-1')
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run('fs-1', '剑道独尊', bookDir)
  const posDir = join(tmp, 'book-pos')
  mkdirSync(join(posDir, '设定'), { recursive: true })
  writeFileSync(join(posDir, '设定', '题材定位.md'), '题材类型：古言宫斗复仇\n目标平台：晋江')
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run('pos-1', '某本书', posDir)
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
  if (prevGptImgKey === undefined) delete process.env.GPT_IMAGE_API_KEY
  else process.env.GPT_IMAGE_API_KEY = prevGptImgKey
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
    delete process.env.GPT_IMAGE_API_KEY
    delete process.env.IMAGE_API_KEY
    delete process.env.OPENAI_API_KEY
    const res = await app.inject({ method: 'POST', url: '/api/books/real-1/cover' })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toMatch(/image API key/i)
  })
})

describe('GET /api/books/:bookId/cover/prompt', () => {
  it('returns a genre-matched prompt for a real book', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/fs-1/cover/prompt' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.prompt).toContain("Title text '剑道独尊'")
    expect(body.genre).toBe('xianxia')
  })

  it('uses 题材定位.md to set genre and platform when present', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/pos-1/cover/prompt' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.genre).toBe('ancient-romance')
    expect(body.platform).toBe('晋江')
    expect(body.prompt).toContain('dreamy ethereal aesthetic') // 晋江 platform style
    expect(body.prompt).toContain('Kai script') // ancient-romance title font
  })

  it('returns 409 for a pending book', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/pending-1/cover/prompt' })
    expect(res.statusCode).toBe(409)
  })

  it('returns 404 for an unknown book', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/nope/cover/prompt' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/books/:bookId/cover/upload', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
  const dataUrl = 'data:image/png;base64,' + PNG.toString('base64')

  it('saves an uploaded data URL as 封面.png', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/books/fs-1/cover/upload', payload: { image: dataUrl } })
    expect(res.statusCode).toBe(201)
    expect(res.json().path).toBe('封面.png')
    expect(existsSync(join(bookDir, '封面.png'))).toBe(true)
  })

  it('returns 400 when no image is provided', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/books/fs-1/cover/upload', payload: { image: '' } })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for non-image data', async () => {
    const junk = 'data:image/png;base64,' + Buffer.from('not an image').toString('base64')
    const res = await app.inject({ method: 'POST', url: '/api/books/fs-1/cover/upload', payload: { image: junk } })
    expect(res.statusCode).toBe(400)
  })

  it('returns 409 for a pending book', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/books/pending-1/cover/upload', payload: { image: dataUrl } })
    expect(res.statusCode).toBe(409)
  })

  it('returns 404 for an unknown book', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/books/nope/cover/upload', payload: { image: dataUrl } })
    expect(res.statusCode).toBe(404)
  })
})
