import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createAgentService } from '../../src/agentic/agent-service.js'
import { createFakeProvider } from '../../src/agentic/providers/fake-provider.js'

function bookCtx(label: string) {
  const root = mkdtempSync(join(tmpdir(), `book-${label}-`))
  mkdirSync(join(root, '大纲'), { recursive: true })
  return { id: `b-${label}`, title: label, rootPath: root }
}

describe('multi-book parallel', () => {
  it('runs two books simultaneously without bleed', async () => {
    const db = new Database(':memory:'); db.exec(schemaSql)
    const service = createAgentService({ db, provider: createFakeProvider(), model: 'gpt-5', maxConcurrent: 5 })
    const meta1 = bookCtx('A')
    const meta2 = bookCtx('B')

    const events1: any[] = []
    const events2: any[] = []
    const em1 = new EventEmitter(); em1.on('event', (e) => events1.push(e))
    const em2 = new EventEmitter(); em2.on('event', (e) => events2.push(e))

    const r1 = await service.start({
      actionKey: 'chapter.continue', bookMeta: meta1,
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: '正文/第001章.md', stage: '待写作' },
      sessionId: 's1', emitter: em1,
    })
    const r2 = await service.start({
      actionKey: 'chapter.continue', bookMeta: meta2,
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: '正文/第001章.md', stage: '待写作' },
      sessionId: 's2', emitter: em2,
    })

    while ([r1.status, r2.status].some((s) => s === 'pending' || s === 'running' || s === 'waiting-answer')) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(r1.status).toBe('succeeded')
    expect(r2.status).toBe('succeeded')
    expect(events1.find((e) => e.type === 'file-updated' && e.path.startsWith('正文'))).toBeTruthy()
    expect(events2.find((e) => e.type === 'file-updated' && e.path.startsWith('正文'))).toBeTruthy()
  })

  it('rejects 6th concurrent start when limit is 5', async () => {
    const db = new Database(':memory:'); db.exec(schemaSql)
    const slow = { name: 'slow', async chat() { await new Promise((r) => setTimeout(r, 200)); return { content: 'ok', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' as const } } }
    const service = createAgentService({ db, provider: slow, model: 'gpt-5', maxConcurrent: 5 })
    const starts = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((n) => {
      const meta = bookCtx(String(n))
      const em = new EventEmitter()
      return service.start({
        actionKey: 'chapter.continue', bookMeta: meta,
        chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
        sessionId: `s${n}`, emitter: em,
      })
    }))
    const rejected = starts.filter((s) => s.status === 'rejected')
    expect(rejected.length).toBeGreaterThanOrEqual(1)
  })
})
