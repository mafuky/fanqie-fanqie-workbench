import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import Database from 'better-sqlite3'
import { schemaSql } from '../../src/db/schema.js'
import { registerAgentSessionsRoutes } from '../../src/server/routes/agent-sessions.js'

let app: FastifyInstance
let db: Database.Database
let workspace: string

function makeDb() {
  const d = new Database(':memory:')
  d.exec(schemaSql)
  return d
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'book-create-'))
  process.env.WORKSPACE_ROOT = workspace
  db = makeDb()
})

afterEach(async () => {
  await app?.close()
  db?.close()
  rmSync(workspace, { recursive: true, force: true })
  delete process.env.WORKSPACE_ROOT
  vi.restoreAllMocks()
})

describe('POST /api/agent-sessions/book-create', () => {
  it('accepts { idea }, inserts a placeholder books row with pending root_path, and starts the agent with onBookNamed + idea', async () => {
    let captured: any = null
    const service: any = {
      start: vi.fn(async (input: any) => { captured = input; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()

    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: '女频豪门追妻火葬场，带悬疑线' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.bookId).toBeTruthy()
    expect(body.sessionId).toBeTruthy()

    const row: any = db.prepare('SELECT id, title, root_path FROM books WHERE id = ?').get(body.bookId)
    expect(row).toBeTruthy()
    expect(row.root_path).toBe(`pending:${body.bookId}`)
    expect(row.title.length).toBeGreaterThan(0)

    expect(captured.actionKey).toBe('book.create')
    expect(captured.bookMeta.idea).toBe('女频豪门追妻火葬场，带悬疑线')
    expect(captured.bookMeta.rootPath).toBe(`pending:${body.bookId}`)
    expect(typeof captured.onBookNamed).toBe('function')
  })

  it('rejects missing idea with 400', async () => {
    const service: any = { start: vi.fn(), cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn() }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('onBookNamed creates the directory, backfills the row, and returns the final path', async () => {
    let onBookNamed: ((t: string) => Promise<{ title: string; rootPath: string }>) | null = null
    const service: any = {
      start: vi.fn(async (input: any) => { onBookNamed = input.onBookNamed; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: '随便想法' } })
    const bookId = res.json().bookId

    const out = await onBookNamed!('雾港疑局')
    expect(out.title).toBe('雾港疑局')
    expect(out.rootPath).toBe(join(workspace, 'novels', '雾港疑局'))
    expect(existsSync(out.rootPath)).toBe(true)

    const row: any = db.prepare('SELECT title, root_path FROM books WHERE id = ?').get(bookId)
    expect(row.title).toBe('雾港疑局')
    expect(row.root_path).toBe(join(workspace, 'novels', '雾港疑局'))
  })

  it('onBookNamed appends （2） on title/dir collision', async () => {
    const existingId = 'existing-book'
    const existingRoot = join(workspace, 'novels', '雾港疑局')
    db.prepare('INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)').run(existingId, '雾港疑局', existingRoot)

    let onBookNamed: ((t: string) => Promise<{ title: string; rootPath: string }>) | null = null
    const service: any = {
      start: vi.fn(async (input: any) => { onBookNamed = input.onBookNamed; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: 'x' } })

    const out = await onBookNamed!('雾港疑局')
    expect(out.title).toBe('雾港疑局（2）')
    expect(out.rootPath).toBe(join(workspace, 'novels', '雾港疑局（2）'))
    expect(existsSync(out.rootPath)).toBe(true)
  })

  it('deletes the placeholder books row when the agent finishes failed before naming', async () => {
    let emitter: EventEmitter | null = null
    const service: any = {
      start: vi.fn(async (input: any) => { emitter = input.emitter; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: 'x' } })
    const bookId = res.json().bookId

    emitter!.emit('event', { type: 'done', status: 'failed' })
    await new Promise((r) => setTimeout(r, 0))

    const row = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId)
    expect(row).toBeUndefined()
  })

  it('does NOT delete the row when failed AFTER naming (real root_path present)', async () => {
    let emitter: EventEmitter | null = null
    let onBookNamed: ((t: string) => Promise<{ title: string; rootPath: string }>) | null = null
    const service: any = {
      start: vi.fn(async (input: any) => { emitter = input.emitter; onBookNamed = input.onBookNamed; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: 'x' } })
    const bookId = res.json().bookId

    await onBookNamed!('已命名书')
    emitter!.emit('event', { type: 'done', status: 'failed' })
    await new Promise((r) => setTimeout(r, 0))

    const row: any = db.prepare('SELECT root_path FROM books WHERE id = ?').get(bookId)
    expect(row).toBeTruthy()
    expect(row.root_path).not.toMatch(/^pending:/)
  })

  it('inserts chapter 1 with absolute source_path on succeeded', async () => {
    let emitter: EventEmitter | null = null
    let onBookNamed: ((t: string) => Promise<{ title: string; rootPath: string }>) | null = null
    const service: any = {
      start: vi.fn(async (input: any) => { emitter = input.emitter; onBookNamed = input.onBookNamed; return { status: 'running', traceId: 1 } }),
      cancel: vi.fn(), get: vi.fn(), submitAnswer: vi.fn(),
    }
    app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { idea: 'x' } })
    const bookId = res.json().bookId

    await onBookNamed!('成稿书')
    emitter!.emit('event', { type: 'done', status: 'succeeded' })
    await new Promise((r) => setTimeout(r, 0))

    const ch: any = db.prepare('SELECT chapter_number, source_path FROM chapters WHERE book_id = ?').get(bookId)
    expect(ch.chapter_number).toBe(1)
    expect(ch.source_path).toBe(join(workspace, 'novels', '成稿书', '正文', '第001章.md'))
  })
})
