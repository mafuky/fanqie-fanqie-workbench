import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerAgentSessionsRoutes } from '../../src/server/routes/agent-sessions.js'
import { createAgentService } from '../../src/agentic/agent-service.js'
import Database from 'better-sqlite3'
import { schemaSql } from '../../src/db/schema.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function buildApp() {
  const db = new Database(':memory:'); db.exec(schemaSql)
  const root = mkdtempSync(join(tmpdir(), 'book-'))
  db.prepare(`INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)`).run('b1', 'T', root)
  db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)`).run('c1', 'b1', 1, 't', '正文/第001章.md', '待写作')
  const service = createAgentService({
    db,
    provider: { name: 'fake', async chat() { return { content: 'ok', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' } } },
    model: 'gpt-5',
    maxConcurrent: 5,
  })
  const app = Fastify()
  registerAgentSessionsRoutes(app, { db, service })
  return { app, service, db }
}

describe('agent-sessions routes', () => {
  it('POST /api/agent-sessions starts a chapter.continue run', async () => {
    const { app } = buildApp()
    const r = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions',
      payload: { actionKey: 'chapter.continue', bookId: 'b1', chapterId: 'c1' },
    })
    expect(r.statusCode).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.sessionId).toBeTruthy()
    expect(body.status).toBeTruthy()
  })

  it('POST returns 409 when book already running', async () => {
    const { app } = buildApp()
    await app.inject({ method: 'POST', url: '/api/agent-sessions', payload: { actionKey: 'chapter.continue', bookId: 'b1', chapterId: 'c1' } })
    const r = await app.inject({ method: 'POST', url: '/api/agent-sessions', payload: { actionKey: 'chapter.continue', bookId: 'b1', chapterId: 'c1' } })
    expect(r.statusCode).toBe(409)
  })

  it('POST /api/agent-sessions/:id/cancel returns 200', async () => {
    const { app } = buildApp()
    const start = await app.inject({ method: 'POST', url: '/api/agent-sessions', payload: { actionKey: 'chapter.continue', bookId: 'b1', chapterId: 'c1' } })
    const sessionId = JSON.parse(start.body).sessionId
    const r = await app.inject({ method: 'POST', url: `/api/agent-sessions/${sessionId}/cancel` })
    expect(r.statusCode).toBe(200)
  })
})
