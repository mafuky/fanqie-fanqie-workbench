import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createAgentRunner } from '../../src/agentic/agent-runner'
import type { Phase } from '../../src/agentic/phases/phase'

function fakeProvider(calls: string[]) {
  return {
    name: 'fake',
    chat: vi.fn(async () => {
      calls.push('chat')
      return { content: 'ok', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 }, finishReason: 'stop' as const }
    }),
  }
}
const traceStore = {
  createTrace: () => 1, appendEvent: () => {}, addUsage: () => {}, endTrace: () => {},
} as any
const toolRegistry = { listFiltered: () => [], execute: async () => ({ ok: true, result: '' }), list: () => [], register: () => {} } as any

function runnerWith(phases: Phase[], calls: string[]) {
  return createAgentRunner({
    bookId: 'b1', chapterId: 'c1',
    bookMeta: { id: 'b1', title: 'T', rootPath: '/x' },
    chapter: { id: 'c1', chapterNumber: 8, title: 't', sourcePath: 'a.md', stage: '已初稿' },
    phases, actionKey: 'chapter.next',
    provider: fakeProvider(calls) as any, toolRegistry, traceStore,
    sessionId: 's1', model: 'm', emitter: new EventEmitter(),
  })
}

const base: Phase = {
  name: 'p', tools: [], maxIterations: 1,
  systemPrompt: () => 'sys', initialUserMessage: () => 'usr',
}

describe('runner phase flags', () => {
  it('skips a phase whose shouldRun returns false — no model call', async () => {
    const calls: string[] = []
    const r = runnerWith([{ ...base, shouldRun: async () => false }], calls)
    await r.start()
    expect(r.status).toBe('succeeded')
    expect(calls).toEqual([]) // model never called
  })

  it('runs the phase when shouldRun returns true', async () => {
    const calls: string[] = []
    const r = runnerWith([{ ...base, shouldRun: async () => true }], calls)
    await r.start()
    expect(calls).toEqual(['chat'])
  })

  it('a nonFatal phase that throws does not fail the run', async () => {
    const calls: string[] = []
    const boom: Phase = { ...base, nonFatal: true, shouldRun: async () => { throw new Error('boom') } }
    const r = runnerWith([boom], calls)
    await r.start()
    expect(r.status).toBe('succeeded')
  })

  it('a normal phase that throws in shouldRun still fails the run', async () => {
    const calls: string[] = []
    const boom: Phase = { ...base, shouldRun: async () => { throw new Error('boom') } }
    const r = runnerWith([boom], calls)
    await r.start()
    expect(r.status).toBe('failed')
  })
})
