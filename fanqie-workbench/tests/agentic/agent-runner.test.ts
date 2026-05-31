import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'
import { createToolRegistry } from '../../src/agentic/tools/tool.js'
import { createAgentRunner } from '../../src/agentic/agent-runner.js'
import type { AgentRunnerOptions } from '../../src/agentic/agent-runner.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'
import type { Phase } from '../../src/agentic/phases/phase.js'
import { createAskUserTool } from '../../src/agentic/tools/ask-user.js'

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
      actionKey: 'chapter.continue',
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
      actionKey: 'chapter.continue',
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

describe('AgentRunner pause + cancel', () => {
  it('pauses on ask_user and resumes when resolver called', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    const emitter = new EventEmitter()

    const resolvers = new Map<string, (s: string) => void>()
    tools.register(createAskUserTool({
      waitForAnswer: (bookId) => new Promise<string>((resolve) => { resolvers.set(bookId, resolve) }),
    }))

    const phase: Phase = {
      name: 'p1', tools: ['ask_user'], maxIterations: 3,
      systemPrompt: () => 'sys', initialUserMessage: () => 'go',
    }

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      actionKey: 'chapter.continue',
      phases: [phase],
      provider: fakeProvider([
        { content: '', toolCalls: [{ id: 'q1', name: 'ask_user', arguments: { question: 'q?', options: [{ label: 'yes' }] } }], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'tool_calls' },
        { content: 'done', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' },
      ]),
      toolRegistry: tools, traceStore, sessionId: 's1', model: 'gpt-5', emitter,
    })

    const promise = runner.start()
    // Wait until runner emits a question event
    await new Promise<void>((resolve) => {
      const h = (e: any) => { if (e.type === 'question') { emitter.off('event', h); resolve() } }
      emitter.on('event', h)
    })
    expect(runner.status).toBe('waiting-answer')
    // Caller forwards the answer to the resolver registered by the ask_user tool
    resolvers.get('b1')!('yes')
    await promise
    expect(runner.status).toBe('succeeded')
  })

  it('cancel sets status to cancelled and stops loop', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    const emitter = new EventEmitter()

    const phase: Phase = {
      name: 'p1', tools: [], maxIterations: 5,
      systemPrompt: () => 'sys', initialUserMessage: () => 'go',
    }

    let calls = 0
    const provider: LlmProvider = {
      name: 'fake',
      async chat() {
        calls++
        await new Promise((r) => setTimeout(r, 5))
        return { content: '', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
      },
    }

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      actionKey: 'chapter.continue',
      phases: [phase, { ...phase, name: 'p2' }],
      provider, toolRegistry: tools, traceStore, sessionId: 's2', model: 'gpt-5', emitter,
    })

    const promise = runner.start()
    runner.cancel()
    await promise
    expect(runner.status).toBe('cancelled')
    expect(calls).toBeLessThanOrEqual(1)
  })
})

describe('AgentRunner streaming', () => {
  it('emits delta events when provider streams content', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    const emitter = new EventEmitter()
    const events: any[] = []
    emitter.on('event', (e) => events.push(e))

    const streamingProvider: LlmProvider = {
      name: 'fake',
      async chat({ onDelta }) {
        onDelta?.('hel')
        onDelta?.('lo')
        return { content: 'hello', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' }
      },
    }

    const phase: Phase = {
      name: 'p1', tools: [], maxIterations: 1,
      systemPrompt: () => 's', initialUserMessage: () => 'go',
    }

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      actionKey: 'chapter.continue',
      phases: [phase],
      provider: streamingProvider,
      toolRegistry: tools, traceStore, sessionId: 's1', model: 'gpt-5', emitter,
    })

    await runner.start()
    const deltas = events.filter((e) => e.type === 'delta')
    expect(deltas.map((d) => d.content)).toEqual(['hel', 'lo'])
    expect(deltas.every((d) => d.phase === 'p1')).toBe(true)
  })

  it('emits tool-call-delta events when provider streams tool arguments', async () => {
    const db = memDb()
    const traceStore = createTraceStore(db)
    const tools = createToolRegistry()
    tools.register({
      spec: { name: 'write_file', description: '', parameters: { type: 'object', properties: {} } },
      async execute() { return { ok: true, result: 'ok' } },
    })
    const emitter = new EventEmitter()
    const events: any[] = []
    emitter.on('event', (e) => events.push(e))

    const streamingProvider: LlmProvider = {
      name: 'fake',
      async chat({ onToolCallDelta }) {
        onToolCallDelta?.({ index: 0, id: 'call_1', name: 'write_file' })
        onToolCallDelta?.({ index: 0, argsFragment: '{"path":"a.md"}' })
        return {
          content: '',
          toolCalls: [{ id: 'call_1', name: 'write_file', arguments: { path: 'a.md' } }],
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: 'tool_calls',
        }
      },
    }

    const phase: Phase = {
      name: 'p1', tools: ['write_file'], maxIterations: 2,
      systemPrompt: () => 's', initialUserMessage: () => 'go',
    }

    const runner = createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp' },
      chapter: { id: 'c1', chapterNumber: 1, title: 't', sourcePath: 'a.md', stage: '待写作' },
      actionKey: 'chapter.continue',
      phases: [phase],
      provider: streamingProvider,
      toolRegistry: tools, traceStore, sessionId: 's2', model: 'gpt-5', emitter,
    })

    await runner.start()
    const tcDeltas = events.filter((e) => e.type === 'tool-call-delta')
    expect(tcDeltas[0]).toMatchObject({ phase: 'p1', toolCallIndex: 0, id: 'call_1', name: 'write_file' })
    expect(tcDeltas[1]).toMatchObject({ phase: 'p1', toolCallIndex: 0, argsFragment: '{"path":"a.md"}' })
  })
})

function noToolProvider(content = 'ok'): LlmProvider {
  return {
    async chat({ onDelta }: any) {
      onDelta?.(content)
      return { content, toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 } }
    },
  } as unknown as LlmProvider
}
const fakeToolRegistry = { listFiltered: () => [], execute: async () => ({ ok: true, result: '' }) } as any
const fakeTraceStore = { createTrace: () => 1, appendEvent: () => {}, addUsage: () => {}, endTrace: () => {} } as any
function baseOpts(overrides: Partial<AgentRunnerOptions>): AgentRunnerOptions {
  return {
    bookId: 'book-1', chapterId: null,
    bookMeta: { id: 'book-1', title: '占位', rootPath: 'pending:book-1' },
    chapter: null, phases: [], actionKey: 'book.create',
    provider: noToolProvider(), toolRegistry: fakeToolRegistry, traceStore: fakeTraceStore,
    sessionId: 'sess-1', model: 'test-model', emitter: new EventEmitter(),
    ...overrides,
  }
}

describe('agent-runner onBookNamed', () => {
  it('calls onBookNamed when a phase emits bookTitle and routes later phases to the new path', async () => {
    const seenRoots: string[] = []
    const namingPhase: Phase = {
      name: 'naming', tools: [], maxIterations: 1,
      systemPrompt: () => 'sys', initialUserMessage: () => 'go',
      async onComplete() { return { directionLocked: true, directionSummary: 'dir', bookTitle: '雾港疑局' } },
    }
    const laterPhase: Phase = {
      name: 'later', tools: [], maxIterations: 1,
      systemPrompt: (ctx) => { seenRoots.push(ctx.bookRoot); return 'sys' },
      initialUserMessage: () => 'go',
    }
    const onBookNamed = vi.fn(async (title: string) => ({ title, rootPath: `/novels/${title}` }))
    const opts = baseOpts({ phases: [namingPhase, laterPhase], onBookNamed })
    const runner = createAgentRunner(opts)
    await runner.start()
    expect(onBookNamed).toHaveBeenCalledTimes(1)
    expect(onBookNamed).toHaveBeenCalledWith('雾港疑局')
    expect(opts.bookMeta.title).toBe('雾港疑局')
    expect(opts.bookMeta.rootPath).toBe('/novels/雾港疑局')
    expect(seenRoots).toEqual(['/novels/雾港疑局'])
    expect(runner.status).toBe('succeeded')
  })

  it('does not call onBookNamed when no phase emits bookTitle (chapter.continue stays unchanged)', async () => {
    const plainPhase: Phase = {
      name: 'plain', tools: [], maxIterations: 1,
      systemPrompt: () => 'sys', initialUserMessage: () => 'go',
      async onComplete() { return { somethingElse: true } },
    }
    const onBookNamed = vi.fn(async (title: string) => ({ title, rootPath: '/x' }))
    const opts = baseOpts({ actionKey: 'chapter.continue', phases: [plainPhase], onBookNamed })
    const runner = createAgentRunner(opts)
    await runner.start()
    expect(onBookNamed).not.toHaveBeenCalled()
    expect(opts.bookMeta.rootPath).toBe('pending:book-1')
    expect(runner.status).toBe('succeeded')
  })

  it('works when onBookNamed is absent and a phase emits bookTitle (no crash)', async () => {
    const namingPhase: Phase = {
      name: 'naming', tools: [], maxIterations: 1,
      systemPrompt: () => 'sys', initialUserMessage: () => 'go',
      async onComplete() { return { bookTitle: '某书' } },
    }
    const opts = baseOpts({ phases: [namingPhase] })
    const runner = createAgentRunner(opts)
    await runner.start()
    expect(runner.status).toBe('succeeded')
  })
})
