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
  onBookNamed?: (title: string) => Promise<{ title: string; rootPath: string }>
  initialResults?: Record<string, unknown>
  /** Called exactly once when the run settles (success/fail/cancel), after the slot is freed. */
  onSettled?: () => void
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
    cancel(bookId) {
      active.get(bookId)?.cancel()
      // Free the slot immediately so a cancelled book never stays "running".
      active.delete(bookId)
    },
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
        onBookNamed: input.onBookNamed,
        initialResults: input.initialResults,
      })
      active.set(input.bookId, runner)
      // Authoritative cleanup: runner.start() settles exactly once when the run truly ends
      // (it catches internally and never rejects). Relying on this — instead of the 'done'
      // event reaching a listener — guarantees the slot is freed even if the event is missed.
      void runner.start().finally(() => {
        // Only release if this runner still owns the slot — a cancel may have freed it and a
        // newer run for the same book may have taken over (don't clobber the newer one).
        if (active.get(input.bookId) !== runner) return
        active.delete(input.bookId)
        input.onSettled?.()
      })
      return runner
    },
  }
}
