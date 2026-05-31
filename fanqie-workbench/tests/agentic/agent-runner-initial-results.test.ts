import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createAgentRunner } from '../../src/agentic/agent-runner.js'
import { createToolRegistry } from '../../src/agentic/tools/tool.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'
import type { Phase } from '../../src/agentic/phases/phase.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}
function makePhase(name: string, overrides: Partial<Phase> = {}): Phase {
  return { name, tools: [], maxIterations: 2, systemPrompt: () => 'sys', initialUserMessage: () => 'user', ...overrides }
}

describe('createAgentRunner initialResults', () => {
  let db: Database.Database
  let traceStore: ReturnType<typeof createTraceStore>
  let toolRegistry: ReturnType<typeof createToolRegistry>
  let emitter: EventEmitter
  beforeEach(() => {
    db = memDb(); traceStore = createTraceStore(db); toolRegistry = createToolRegistry(); emitter = new EventEmitter()
  })
  function makeRunner(phases: Phase[], provider: LlmProvider, initialResults?: Record<string, unknown>) {
    return createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp/x' },
      chapter: { id: 'c1', chapterNumber: 1, title: 'C1', sourcePath: '/tmp/x/正文/第001章.md', stage: 's' },
      phases, actionKey: 'chapter.revise', provider, toolRegistry, traceStore, sessionId: 's1', model: 'm', emitter, initialResults,
    })
  }
  it('seeds previousPhaseResults so the first phase can read the value', async () => {
    let captured = ''
    const phase = makePhase('a', { initialUserMessage: (ctx) => `inst=${ctx.previousPhaseResults.reviseInstruction}` })
    const provider: LlmProvider = {
      name: 'fake',
      async chat(req) {
        captured = req.messages.find((m) => m.role === 'user')?.content ?? ''
        return { content: 'ok', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 }, finishReason: 'stop' }
      },
    }
    const runner = makeRunner([phase], provider, { reviseInstruction: '改得更狠' })
    await runner.start()
    expect(captured).toContain('inst=改得更狠')
  })
  it('behaves unchanged when initialResults is omitted', async () => {
    let captured = 'unset'
    const phase = makePhase('a', { initialUserMessage: (ctx) => `inst=${ctx.previousPhaseResults.reviseInstruction ?? 'none'}` })
    const provider: LlmProvider = {
      name: 'fake',
      async chat(req) {
        captured = req.messages.find((m) => m.role === 'user')?.content ?? ''
        return { content: 'ok', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 }, finishReason: 'stop' }
      },
    }
    const runner = makeRunner([phase], provider)
    await runner.start()
    expect(captured).toContain('inst=none')
  })
})
