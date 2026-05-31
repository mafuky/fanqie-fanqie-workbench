import type { EventEmitter } from 'node:events'
import type { ChatMessage, LlmProvider } from './providers/provider.js'
import type { Phase, BookMeta, ChapterMeta, PhaseContext } from './phases/phase.js'
import type { ToolRegistry } from './tools/tool.js'
import type { TraceStore } from './trace-store.js'
import type { AgentEvent } from './events.js'

export interface AgentRunnerOptions {
  bookId: string
  chapterId: string | null
  bookMeta: BookMeta
  chapter: ChapterMeta | null
  phases: Phase[]
  actionKey: string
  provider: LlmProvider
  toolRegistry: ToolRegistry
  traceStore: TraceStore
  sessionId: string
  model: string
  emitter: EventEmitter
  onAskUserPending?: (pending: boolean) => void
  /** Only set for book.create. Called after a phase produces `bookTitle`; backfills directory + DB and returns the final title/rootPath. */
  onBookNamed?: (title: string) => Promise<{ title: string; rootPath: string }>
}

export type AgentRunnerStatus = 'pending' | 'running' | 'waiting-answer' | 'succeeded' | 'failed' | 'cancelled'

export interface AgentRunner {
  readonly status: AgentRunnerStatus
  readonly currentPhase: string | null
  readonly traceId: number
  start(): Promise<void>
  cancel(): void
  /** No-op pass-through retained for API symmetry; the actual answer goes to the ask_user tool resolver owned by AgentService. */
  submitAnswer(answer: string): void
}

export function createAgentRunner(opts: AgentRunnerOptions): AgentRunner {
  const traceId = opts.traceStore.createTrace({
    bookId: opts.bookId,
    chapterId: opts.chapterId,
    actionKey: opts.actionKey,
    sessionId: opts.sessionId,
    model: opts.model,
  })
  let status: AgentRunnerStatus = 'pending'
  let currentPhase: string | null = null
  let cancelled = false
  const previousPhaseResults: Record<string, unknown> = {}

  function emit(ev: AgentEvent) {
    opts.emitter.emit('event', ev)
    if (ev.type !== 'delta' && ev.type !== 'tool-call-delta') {
      opts.traceStore.appendEvent(traceId, { phase: currentPhase ?? 'system', eventType: ev.type, payload: ev })
    }
  }

  function checkCancelled() {
    if (cancelled) throw new Error('cancelled')
  }

  return {
    get status() { return status },
    get currentPhase() { return currentPhase },
    traceId,
    cancel() { cancelled = true },
    submitAnswer(_answer: string) { /* delegated to ask_user tool resolver in AgentService */ },
    async start() {
      status = 'running'
      try {
        for (const phase of opts.phases) {
          checkCancelled()
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
            checkCancelled()
            const tools = opts.toolRegistry.listFiltered(phase.tools)
            const result = await opts.provider.chat({
              model: opts.model,
              messages,
              tools,
              onDelta: (d) => emit({ type: 'delta', phase: phase.name, content: d }),
              onToolCallDelta: (d) => emit({
                type: 'tool-call-delta',
                phase: phase.name,
                toolCallIndex: d.index,
                id: d.id,
                name: d.name,
                argsFragment: d.argsFragment,
              }),
            })
            opts.traceStore.addUsage(traceId, result.usage)
            emit({ type: 'message', phase: phase.name, role: 'assistant', content: result.content })
            lastResult = result
            if (result.toolCalls.length === 0) break
            messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls })
            for (const call of result.toolCalls) {
              checkCancelled()
              emit({ type: 'tool-call', phase: phase.name, toolCallId: call.id, name: call.name, args: call.arguments })
              if (call.name === 'ask_user') {
                status = 'waiting-answer'
                opts.onAskUserPending?.(true)
              }
              const toolResult = await opts.toolRegistry.execute(call, {
                bookId: opts.bookId, bookRoot: opts.bookMeta.rootPath, emit,
              })
              if (call.name === 'ask_user') {
                status = 'running'
                opts.onAskUserPending?.(false)
              }
              const content = toolResult.ok ? toolResult.result : `ERROR: ${toolResult.error}`
              emit({ type: 'tool-result', phase: phase.name, toolCallId: call.id, name: call.name, result: content, ok: toolResult.ok })
              messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content })
            }
          }
          if (lastResult && phase.onComplete) {
            const update = await phase.onComplete(ctx, lastResult)
            if (update) {
              Object.assign(previousPhaseResults, update)
              const namedTitle = (update as { bookTitle?: unknown }).bookTitle
              if (typeof namedTitle === 'string' && namedTitle && opts.onBookNamed) {
                const { title, rootPath } = await opts.onBookNamed(namedTitle)
                opts.bookMeta.title = title
                opts.bookMeta.rootPath = rootPath
              }
            }
          }
          emit({ type: 'phase-done', phase: phase.name })
        }
        status = 'succeeded'
        opts.traceStore.endTrace(traceId, 'succeeded')
        emit({ type: 'done', status: 'succeeded' })
      } catch (err: any) {
        if (cancelled) {
          status = 'cancelled'
          opts.traceStore.endTrace(traceId, 'cancelled')
          emit({ type: 'done', status: 'cancelled' })
        } else {
          status = 'failed'
          opts.traceStore.endTrace(traceId, 'failed')
          emit({ type: 'error', message: err?.message ?? String(err) })
          emit({ type: 'done', status: 'failed' })
        }
      }
    },
  }
}
