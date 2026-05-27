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
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'workspace-'))
  process.env.WORKSPACE_ROOT = workspaceRoot
  const service = createAgentService({
    db,
    provider: { name: 'fake', async chat() { return { content: 'done', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' } } },
    model: 'gpt-5',
    maxConcurrent: 5,
  })
  const app = Fastify()
  registerAgentSessionsRoutes(app, { db, service })
  return { app, db, workspaceRoot }
}

describe('book-create route', () => {
  it('POST /api/agent-sessions/book-create creates book row + dir + runs agent', async () => {
    const { app, db } = buildApp()
    const r = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions/book-create',
      payload: { title: '测试新书' },
    })
    expect(r.statusCode).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.bookId).toBeTruthy()
    expect(body.sessionId).toBeTruthy()
    // Books row created
    const bookRow: any = db.prepare(`SELECT title, root_path FROM books WHERE id = ?`).get(body.bookId)
    expect(bookRow.title).toBe('测试新书')
    expect(bookRow.root_path).toContain('测试新书')
  })

  it('returns 400 for invalid title', async () => {
    const { app } = buildApp()
    const r = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions/book-create',
      payload: { title: '' },
    })
    expect(r.statusCode).toBe(400)
  })

  it('returns 400 for title with slashes', async () => {
    const { app } = buildApp()
    const r = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions/book-create',
      payload: { title: 'evil/path' },
    })
    expect(r.statusCode).toBe(400)
  })

  it('returns 409 for duplicate title', async () => {
    const { app } = buildApp()
    await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { title: '重名书' } })
    const r2 = await app.inject({ method: 'POST', url: '/api/agent-sessions/book-create', payload: { title: '重名书' } })
    expect(r2.statusCode).toBe(409)
  })
})
