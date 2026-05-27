import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createAgentService } from '../../src/agentic/agent-service.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'

const fakeProvider: LlmProvider = {
  name: 'fake',
  async chat() {
    return { content: 'done', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
  },
}

describe('AgentService', () => {
  it('starts a chapter.continue session and routes events through provided emitter', async () => {
    const db = new Database(':memory:'); db.exec(schemaSql)
    const root = mkdtempSync(join(tmpdir(), 'book-'))
    const service = createAgentService({ db, provider: fakeProvider, model: 'gpt-5', maxConcurrent: 5 })
    const emitter = new EventEmitter()
    const events: any[] = []
    emitter.on('event', (e) => events.push(e))
    const runner = await service.start({
      actionKey: 'chapter.continue',
      bookMeta: { id: 'b1', title: 'T', rootPath: root },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: '正文/第001章.md', stage: '待写作' },
      sessionId: 's1', emitter,
    })
    while (runner.status === 'running' || runner.status === 'pending') {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(runner.status).toBe('succeeded')
    expect(events.some((e) => e.type === 'phase-start' && e.phase === 'load-context')).toBe(true)
  })
})
