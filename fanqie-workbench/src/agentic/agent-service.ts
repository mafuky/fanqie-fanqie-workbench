import type Database from 'better-sqlite3'
import type { EventEmitter } from 'node:events'
import { routeAction } from './action-router.js'
import { createAgentRunnerPool } from './agent-runner-pool.js'
import type { AgentRunner } from './agent-runner.js'
import { createTraceStore } from './trace-store.js'
import { createToolRegistry } from './tools/tool.js'
import { readFileTool } from './tools/read-file.js'
import { listDirTool } from './tools/list-dir.js'
import { grepTool } from './tools/grep.js'
import { writeFileTool } from './tools/write-file.js'
import { updateTrackingTool } from './tools/update-tracking.js'
import { createAskUserTool } from './tools/ask-user.js'
import type { LlmProvider } from './providers/provider.js'
import type { BookMeta, ChapterMeta } from './phases/phase.js'

export interface AgentServiceOptions {
  db: Database.Database
  provider: LlmProvider
  model: string
  maxConcurrent: number
}

export interface AgentStartInput {
  actionKey: string
  bookMeta: BookMeta
  chapter: ChapterMeta
  sessionId: string
  emitter: EventEmitter
}

export interface AgentService {
  start(input: AgentStartInput): Promise<AgentRunner>
  cancel(bookId: string): void
  get(bookId: string): AgentRunner | null
  submitAnswer(bookId: string, answer: string): void
}

export function createAgentService(opts: AgentServiceOptions): AgentService {
  const traceStore = createTraceStore(opts.db)
  // bookId → resolver waiting on the user's answer for that book
  const pendingAnswers = new Map<string, (s: string) => void>()
  const tools = createToolRegistry()
  tools.register(readFileTool)
  tools.register(listDirTool)
  tools.register(grepTool)
  tools.register(writeFileTool)
  tools.register(updateTrackingTool)
  tools.register(createAskUserTool({
    waitForAnswer: (bookId) => new Promise<string>((resolve) => {
      pendingAnswers.set(bookId, resolve)
    }),
  }))

  const pool = createAgentRunnerPool({
    provider: opts.provider,
    traceStore,
    toolRegistry: tools,
    maxConcurrent: opts.maxConcurrent,
    model: opts.model,
  })

  return {
    get(bookId) { return pool.get(bookId) },
    cancel(bookId) {
      pool.cancel(bookId)
      // also unblock any pending ask_user resolver for this book so the runner can finish
      const resolver = pendingAnswers.get(bookId)
      if (resolver) {
        resolver('__cancelled__')
        pendingAnswers.delete(bookId)
      }
    },
    submitAnswer(bookId, answer) {
      const resolver = pendingAnswers.get(bookId)
      if (resolver) {
        resolver(answer)
        pendingAnswers.delete(bookId)
      }
    },
    async start(input) {
      const phases = routeAction(input.actionKey)
      return pool.start({
        bookId: input.bookMeta.id,
        chapterId: input.chapter.id,
        bookMeta: input.bookMeta,
        chapter: input.chapter,
        phases,
        sessionId: input.sessionId,
        emitter: input.emitter,
      })
    },
  }
}
