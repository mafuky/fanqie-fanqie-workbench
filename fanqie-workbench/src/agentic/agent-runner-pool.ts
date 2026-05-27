import type { EventEmitter } from 'node:events'
import { createAgentRunner } from './agent-runner.js'
import type { AgentRunner } from './agent-runner.js'
import type { BookMeta, ChapterMeta, Phase } from './phases/phase.js'
import type { LlmProvider } from './providers/provider.js'
import type { ToolRegistry } from './tools/tool.js'
import type { TraceStore } from './trace-store.js'

export interface AgentRunnerPoolOptions {
  provider: LlmProvider
  traceStore: TraceStore
  toolRegistry: ToolRegistry
  maxConcurrent: number
  model: string
}

export interface PoolStartInput {
  bookId: string
  chapterId: string | null
  bookMeta: BookMeta
  chapter: ChapterMeta | null
  phases: Phase[]
  actionKey: string
  sessionId: string
  emitter: EventEmitter
}

export interface AgentRunnerPool {
  start(input: PoolStartInput): Promise<AgentRunner>
  get(bookId: string): AgentRunner | null
  cancel(bookId: string): void
  activeCount(): number
}

export function createAgentRunnerPool(opts: AgentRunnerPoolOptions): AgentRunnerPool {
  const active = new Map<string, AgentRunner>()

  return {
    activeCount() { return active.size },
    get(bookId) { return active.get(bookId) ?? null },
    cancel(bookId) { active.get(bookId)?.cancel() },
    async start(input) {
      if (active.has(input.bookId)) {
        throw new Error(`book ${input.bookId} already running`)
      }
      if (active.size >= opts.maxConcurrent) {
        throw new Error(`concurrent limit reached (${opts.maxConcurrent})`)
      }
      const runner = createAgentRunner({
        bookId: input.bookId, chapterId: input.chapterId,
        bookMeta: input.bookMeta, chapter: input.chapter,
        phases: input.phases,
        actionKey: input.actionKey,
        provider: opts.provider,
        toolRegistry: opts.toolRegistry,
        traceStore: opts.traceStore,
        sessionId: input.sessionId,
        model: opts.model,
        emitter: input.emitter,
      })
      active.set(input.bookId, runner)
      input.emitter.on('event', (ev: any) => {
        if (ev.type === 'done') active.delete(input.bookId)
      })
      void runner.start()
      return runner
    },
  }
}
