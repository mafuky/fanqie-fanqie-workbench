import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { schemaSql } from '../../src/db/schema.js'
import { registerBookAssetsRoutes } from '../../src/server/routes/book-assets.js'

let app: FastifyInstance
let tmp: string
let dbPath: string
let prevDb: string | undefined
let bookRoot: string

beforeEach(async () => {
  prevDb = process.env.WORKBENCH_DB
  tmp = mkdtempSync(join(tmpdir(), 'assets-'))
  dbPath = join(tmp, 'test.sqlite')
  process.env.WORKBENCH_DB = dbPath
  bookRoot = join(tmp, 'book')
  mkdirSync(join(bookRoot, '设定', '角色'), { recursive: true })
  mkdirSync(join(bookRoot, '正文'), { recursive: true })
  mkdirSync(join(bookRoot, '.git'), { recursive: true })
  writeFileSync(join(bookRoot, '设定', '世界观.md'), '# 世界观')
  writeFileSync(join(bookRoot, '设定', '角色', '主角.md'), '# 主角')
  writeFileSync(join(bookRoot, '正文', '第001章.md'), '# 第一章')
  writeFileSync(join(bookRoot, '封面.png'), 'PNGDATA')
  writeFileSync(join(bookRoot, '.git', 'config'), 'secret')
  const db = new Database(dbPath)
  db.exec(schemaSql)
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run('b1', '测试书', bookRoot)
  db.close()
  app = Fastify()
  await registerBookAssetsRoutes(app)
  await app.ready()
})

afterEach(async () => {
  await app?.close()
  rmSync(tmp, { recursive: true, force: true })
  if (prevDb === undefined) delete process.env.WORKBENCH_DB
  else process.env.WORKBENCH_DB = prevDb
})

describe('GET /api/books/:bookId/assets', () => {
  it('returns a recursive tree excluding hidden dirs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/b1/assets' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { tree: any[] }
    const names = body.tree.map((n) => n.name)
    expect(names).toContain('设定')
    expect(names).toContain('正文')
    expect(names).toContain('封面.png')
    expect(names).not.toContain('.git')
    const sheding = body.tree.find((n: any) => n.name === '设定')
    expect(sheding.type).toBe('dir')
    expect(sheding.children.map((c: any) => c.name)).toContain('世界观.md')
    const cover = body.tree.find((n: any) => n.name === '封面.png')
    expect(cover.type).toBe('image')
    const zhengwen = body.tree.find((n: any) => n.name === '正文')
    expect(zhengwen.children[0].type).toBe('text')
  })
  it('returns 404 for unknown book', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/nope/assets' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/books/:bookId/file', () => {
  it('returns text content as JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/b1/file?path=' + encodeURIComponent('设定/世界观.md') })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ path: '设定/世界观.md', content: '# 世界观' })
  })
  it('returns image as binary with content-type', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/b1/file?path=' + encodeURIComponent('封面.png') })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
  })
  it('rejects path traversal with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/b1/file?path=' + encodeURIComponent('../../../etc/passwd') })
    expect(res.statusCode).toBe(400)
  })
  it('returns 404 for missing file', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/books/b1/file?path=' + encodeURIComponent('设定/不存在.md') })
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /api/books/:bookId/file', () => {
  it('writes text content', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/books/b1/file', payload: { path: '设定/世界观.md', content: '# 新世界观' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ saved: true })
    const check = await app.inject({ method: 'GET', url: '/api/books/b1/file?path=' + encodeURIComponent('设定/世界观.md') })
    expect(check.json()).toMatchObject({ content: '# 新世界观' })
  })
  it('rejects writing image extensions with 400', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/books/b1/file', payload: { path: '封面.png', content: 'x' } })
    expect(res.statusCode).toBe(400)
  })
  it('rejects path traversal with 400', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/books/b1/file', payload: { path: '../escape.md', content: 'x' } })
    expect(res.statusCode).toBe(400)
  })
})
