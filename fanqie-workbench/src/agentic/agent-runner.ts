import type { EventEmitter } from 'node:events'
import type { ChatMessage, LlmProvider } from './providers/provider.js'
import type { Phase, BookMeta, ChapterMeta, PhaseContext } from './phases/phase.js'
import type { ToolRegistry } from './tools/tool.js'
import type { TraceStore } from './trace-store.js'
import type { AgentEvent } from './events.js'

export interface AgentRunnerOptions {
  bookId: string
  chapterId: string
  bookMeta: BookMeta
  chapter: ChapterMeta
  phases: Phase[]
  provider: LlmProvider
  toolRegistry: ToolRegistry
  traceStore: TraceStore
  sessionId: string
  model: string
  emitter: EventEmitter
}

export type AgentRunnerStatus = 'pending' | 'running' | 'waiting-answer' | 'succeeded' | 'failed' | 'cancelled'

export interface AgentRunner {
  readonly status: AgentRunnerStatus
  readonly currentPhase: string | null
  readonly traceId: number
  start(): Promise<void>
}

export function createAgentRunner(opts: AgentRunnerOptions): AgentRunner {
  const traceId = opts.traceStore.createTrace({
    bookId: opts.bookId,
    chapterId: opts.chapterId,
    actionKey: 'chapter.continue',
    sessionId: opts.sessionId,
    model: opts.model,
  })
  let status: AgentRunnerStatus = 'pending'
  let currentPhase: string | null = null
  const previousPhaseResults: Record<string, unknown> = {}

  function emit(ev: AgentEvent) {
    opts.emitter.emit('event', ev)
    opts.traceStore.appendEvent(traceId, { phase: currentPhase ?? 'system', eventType: ev.type, payload: ev })
  }

  return {
    get status() { return status },
    get currentPhase() { return currentPhase },
    traceId,
    async start() {
      status = 'running'
      try {
        for (const phase of opts.phases) {
          currentPhase = phase.name
          emit({ type: 'phase-start', phase: phase.name })
          const ctx: PhaseContext = {
            bookId: opts.bookId, bookRoot: opts.bookMeta.rootPath, chapterId: opts.chapterId,
            bookMeta: opts.bookMeta, chapter: opts.chapter, previousPhaseResults,
          }
          const messages: ChatMessage[] = [
            { role: 'system', content: phase.systemPrompt(ctx) },
            { role: 'user', content: phase.initialUserMessage(ctx) },
          ]
          let lastResult: any = null
          for (let iter = 0; iter < phase.maxIterations; iter++) {
            const tools = opts.toolRegistry.listFiltered(phase.tools)
            const result = await opts.provider.chat({
              model: opts.model,
              messages,
              tools,
            })
            opts.traceStore.addUsage(traceId, result.usage)
            emit({ type: 'message', phase: phase.name, role: 'assistant', content: result.content })
            lastResult = result
            if (result.toolCalls.length === 0) break
            messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls })
            for (const call of result.toolCalls) {
              emit({ type: 'tool-call', phase: phase.name, toolCallId: call.id, name: call.name, args: call.arguments })
              const toolResult = await opts.toolRegistry.execute(call, {
                bookId: opts.bookId,
                bookRoot: opts.bookMeta.rootPath,
                emit,
              })
              const content = toolResult.ok ? toolResult.result : `ERROR: ${toolResult.error}`
              emit({ type: 'tool-result', phase: phase.name, toolCallId: call.id, name: call.name, result: content, ok: toolResult.ok })
              messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content })
            }
          }
          if (lastResult && phase.onComplete) {
            const update = await phase.onComplete(ctx, lastResult)
            if (update) Object.assign(previousPhaseResults, update)
          }
          emit({ type: 'phase-done', phase: phase.name })
        }
        status = 'succeeded'
        opts.traceStore.endTrace(traceId, 'succeeded')
        emit({ type: 'done', status: 'succeeded' })
      } catch (err: any) {
        status = 'failed'
        opts.traceStore.endTrace(traceId, 'failed')
        emit({ type: 'error', message: err?.message ?? String(err) })
        emit({ type: 'done', status: 'failed' })
      }
    },
  }
}
