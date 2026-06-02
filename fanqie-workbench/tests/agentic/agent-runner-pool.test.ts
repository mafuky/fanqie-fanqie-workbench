import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'
import { createToolRegistry } from '../../src/agentic/tools/tool.js'
import { createAgentRunnerPool } from '../../src/agentic/agent-runner-pool.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'
import type { Phase } from '../../src/agentic/phases/phase.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}

const phase: Phase = {
  name: 'p1', tools: [], maxIterations: 1,
  systemPrompt: () => 's', initialUserMessage: () => 'go',
}

const slowProvider: LlmProvider = {
  name: 'fake',
  async chat() {
    await new Promise((r) => setTimeout(r, 50))
    return { content: 'ok', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
  },
}

async function waitForFinish(runner: { status: string }) {
  while (runner.status === 'running' || runner.status === 'pending') {
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('AgentRunnerPool', () => {
  it('rejects second start for same bookId while first runs', async () => {
    const db = memDb()
    const pool = createAgentRunnerPool({
      provider: slowProvider, traceStore: createTraceStore(db), toolRegistry: createToolRegistry(),
      maxConcurrent: 5, model: 'gpt-5',
    })
    const runner1 = await pool.start({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], actionKey: 'chapter.continue', sessionId: 's1', emitter: new EventEmitter(),
    })
    await expect(pool.start({
      bookId: 'b1', chapterId: 'c2',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c2', chapterNumber: 2, title: 't', sourcePath: 'b.md', stage: '待写作' },
      phases: [phase], actionKey: 'chapter.continue', sessionId: 's2', emitter: new EventEmitter(),
    })).rejects.toThrow(/already running/i)
    await waitForFinish(runner1)
  })

  it('rejects when maxConcurrent reached', async () => {
    const db = memDb()
    const pool = createAgentRunnerPool({
      provider: slowProvider, traceStore: createTraceStore(db), toolRegistry: createToolRegistry(),
      maxConcurrent: 1, model: 'gpt-5',
    })
    const r1 = await pool.start({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], actionKey: 'chapter.continue', sessionId: 's1', emitter: new EventEmitter(),
    })
    await expect(pool.start({
      bookId: 'b2', chapterId: 'c1',
      bookMeta: { id: 'b2', title: 'T2', rootPath: '/tmp/2' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], actionKey: 'chapter.continue', sessionId: 's2', emitter: new EventEmitter(),
    })).rejects.toThrow(/concurrent limit/i)
    await waitForFinish(r1)
  })

  it('cancel frees the slot immediately so another book can run (maxConcurrent)', async () => {
    const db = memDb()
    const pool = createAgentRunnerPool({
      provider: slowProvider, traceStore: createTraceStore(db), toolRegistry: createToolRegistry(),
      maxConcurrent: 1, model: 'gpt-5',
    })
    await pool.start({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], actionKey: 'chapter.continue', sessionId: 's1', emitter: new EventEmitter(),
    })
    expect(pool.activeCount()).toBe(1)
    pool.cancel('b1')
    expect(pool.activeCount()).toBe(0)
    const r2 = await pool.start({
      bookId: 'b2', chapterId: 'c1',
      bookMeta: { id: 'b2', title: 'T2', rootPath: '/tmp/2' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], actionKey: 'chapter.continue', sessionId: 's2', emitter: new EventEmitter(),
    })
    await waitForFinish(r2)
    expect(r2.status).toBe('succeeded')
  })

  it('calls onSettled when the run finishes', async () => {
    const db = memDb()
    const pool = createAgentRunnerPool({
      provider: slowProvider, traceStore: createTraceStore(db), toolRegistry: createToolRegistry(),
      maxConcurrent: 1, model: 'gpt-5',
    })
    let settled = false
    const r1 = await pool.start({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], actionKey: 'chapter.continue', sessionId: 's1', emitter: new EventEmitter(),
      onSettled: () => { settled = true },
    })
    await waitForFinish(r1)
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(true)
    expect(pool.activeCount()).toBe(0)
  })

  it('releases slot when runner finishes', async () => {
    const db = memDb()
    const pool = createAgentRunnerPool({
      provider: slowProvider, traceStore: createTraceStore(db), toolRegistry: createToolRegistry(),
      maxConcurrent: 1, model: 'gpt-5',
    })
    const r1 = await pool.start({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], actionKey: 'chapter.continue', sessionId: 's1', emitter: new EventEmitter(),
    })
    await waitForFinish(r1)
    const r2 = await pool.start({
      bookId: 'b2', chapterId: 'c1',
      bookMeta: { id: 'b2', title: 'T2', rootPath: '/tmp/2' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase], actionKey: 'chapter.continue', sessionId: 's2', emitter: new EventEmitter(),
    })
    await waitForFinish(r2)
    expect(r2.status).toBe('succeeded')
  })
})
