import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'
import { createToolRegistry } from '../../src/agentic/tools/tool.js'
import { createAgentRunner } from '../../src/agentic/agent-runner.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'
import type { Phase } from '../../src/agentic/phases/phase.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}

const phase: Phase = {
  name: 'p1',
  tools: ['echo'],
  maxIterations: 3,
  systemPrompt: () => 'sys',
  initialUserMessage: () => 'go',
}

const fakeProvider = (responses: any[]): LlmProvider => {
  let i = 0
  return {
    name: 'fake',
    async chat() {
      const r = responses[i++]
      return r
    },
  }
}

describe('AgentRunner basic loop', () => {
  it('runs a single phase to completion when model returns no tool calls', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    const emitter = new EventEmitter()
    const events: any[] = []
    emitter.on('event', (e) => events.push(e))

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase],
      provider: fakeProvider([
        { content: 'done', toolCalls: [], usage: { promptTokens: 5, completionTokens: 2 }, finishReason: 'stop' },
      ]),
      toolRegistry: tools,
      traceStore,
      sessionId: 's1',
      model: 'gpt-5',
      emitter,
    })

    await runner.start()
    expect(runner.status).toBe('succeeded')
    const types = events.map((e) => e.type)
    expect(types).toContain('phase-start')
    expect(types).toContain('phase-done')
    expect(types).toContain('done')
  })

  it('invokes tool and feeds result back into messages', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    tools.register({
      spec: { name: 'echo', description: '', parameters: { type: 'object', properties: {} } },
      async execute({ args }) { return { ok: true, result: `echoed:${args.msg ?? ''}` } },
    })
    const emitter = new EventEmitter()

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      phases: [phase],
      provider: fakeProvider([
        { content: '', toolCalls: [{ id: 't1', name: 'echo', arguments: { msg: 'hi' } }], usage: { promptTokens: 5, completionTokens: 2 }, finishReason: 'tool_calls' },
        { content: 'all done', toolCalls: [], usage: { promptTokens: 5, completionTokens: 2 }, finishReason: 'stop' },
      ]),
      toolRegistry: tools,
      traceStore,
      sessionId: 's2',
      model: 'gpt-5',
      emitter,
    })

    await runner.start()
    expect(runner.status).toBe('succeeded')
  })
})
