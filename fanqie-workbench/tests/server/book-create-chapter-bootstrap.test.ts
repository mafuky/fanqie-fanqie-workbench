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

describe('book-create auto-bootstrap chapter', () => {
  it('inserts a chapter 1 row when agent finishes with succeeded', async () => {
    const { app, db } = buildApp()
    const r = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions/book-create',
      payload: { title: '自动建章测试书' },
    })
    expect(r.statusCode).toBe(200)
    const { bookId } = JSON.parse(r.body)
    // Wait long enough for the fake provider to finish all phases + emit done
    await new Promise((res) => setTimeout(res, 200))
    const chapter: any = db.prepare(`SELECT chapter_number, title, source_path, stage FROM chapters WHERE book_id = ?`).get(bookId)
    expect(chapter).toBeTruthy()
    expect(chapter.chapter_number).toBe(1)
    expect(chapter.title).toBe('第一章')
    expect(chapter.source_path).toBe('正文/第001章.md')
    expect(chapter.stage).toBe('待写作')
  })

  it('does NOT insert chapter when agent fails', async () => {
    // Provider that throws
    const db = new Database(':memory:'); db.exec(schemaSql)
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'workspace-'))
    process.env.WORKSPACE_ROOT = workspaceRoot
    const service = createAgentService({
      db,
      provider: { name: 'fake', async chat() { throw new Error('LLM down') } },
      model: 'gpt-5',
      maxConcurrent: 5,
    })
    const app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })
    const r = await app.inject({
      method: 'POST',
      url: '/api/agent-sessions/book-create',
      payload: { title: 'agent失败测试书' },
    })
    expect(r.statusCode).toBe(200)
    const { bookId } = JSON.parse(r.body)
    await new Promise((res) => setTimeout(res, 200))
    const chapter = db.prepare(`SELECT id FROM chapters WHERE book_id = ?`).get(bookId)
    expect(chapter).toBeFalsy()
  })
})
