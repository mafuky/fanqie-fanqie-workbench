import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { registerAgentSessionsRoutes } from '../../src/server/routes/agent-sessions.js'
import type { AgentService } from '../../src/agentic/agent-service.js'
import type { AgentRunner } from '../../src/agentic/agent-runner.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}
function fakeService(overrides: Partial<AgentService> = {}): AgentService {
  return {
    start: async () => ({ status: 'running', currentPhase: null, traceId: 7, start: async () => {}, cancel: () => {}, submitAnswer: () => {} } as AgentRunner),
    cancel: () => {}, get: () => null, submitAnswer: () => {},
    ...overrides,
  }
}

describe('agent-sessions chapter-next route', () => {
  let db: Database.Database
  let bookRoot: string
  beforeEach(() => { db = memDb(); bookRoot = mkdtempSync(join(tmpdir(), 'cn-')) })
  afterEach(() => { db.close(); rmSync(bookRoot, { recursive: true, force: true }) })

  it('returns 404 for missing book', async () => {
    const app = Fastify()
    registerAgentSessionsRoutes(app, { db, service: fakeService() })
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/chapter-next', payload: { bookId: 'nope' } })
    expect(res.statusCode).toBe(404)
  })

  it('creates the next chapter (1 when none) with absolute source_path and starts chapter.next', async () => {
    let started: any = null
    const service = fakeService({ start: async (input) => { started = input; return { status: 'running', currentPhase: null, traceId: 7, start: async () => {}, cancel: () => {}, submitAnswer: () => {} } as AgentRunner } })
    const app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    const bookId = 'book-cn-1'
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)`).run(bookId, '测试书', bookRoot)
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/chapter-next', payload: { bookId } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.sessionId).toBeTruthy()
    expect(body.chapterId).toBeTruthy()
    expect(body.traceId).toBe(7)
    const expectedPath = join(bookRoot, '正文', '第001章.md')
    const row: any = db.prepare(`SELECT * FROM chapters WHERE id = ?`).get(body.chapterId)
    expect(row.chapter_number).toBe(1)
    expect(row.source_path).toBe(expectedPath)
    expect(existsSync(expectedPath)).toBe(true)
    expect(readFileSync(expectedPath, 'utf8')).toContain('第1章')
    expect(started.actionKey).toBe('chapter.next')
    expect(started.chapter.chapterNumber).toBe(1)
    expect(started.chapter.sourcePath).toBe(expectedPath)
  })

  it('computes next = max + 1 when chapters exist', async () => {
    const app = Fastify()
    registerAgentSessionsRoutes(app, { db, service: fakeService() })
    const bookId = 'book-cn-2'
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)`).run(bookId, '测试书2', bookRoot)
    db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('c1', bookId, 3, '第三章', join(bookRoot, '正文', '第003章.md'), '已写作')
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/chapter-next', payload: { bookId } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const row: any = db.prepare(`SELECT * FROM chapters WHERE id = ?`).get(body.chapterId)
    expect(row.chapter_number).toBe(4)
    expect(row.source_path).toBe(join(bookRoot, '正文', '第004章.md'))
  })
})
