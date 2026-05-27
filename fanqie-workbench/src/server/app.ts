import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerTaskStreamRoutes } from './routes/task-stream.js'
import { registerBookRoutes } from './routes/books.js'
import { registerChapterRoutes } from './routes/chapters.js'
import { registerChapterContentRoutes } from './routes/chapter-content.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerActionRoutes } from './routes/actions.js'
import { registerReviewCheckpointRoutes } from './routes/review-checkpoints.js'
import { registerMarketScanRoutes } from './routes/market-scans.js'
import { registerAccountRoutes } from './routes/accounts.js'
import { registerStorySetupRoutes } from './routes/story-setup.js'
import { registerPtyWsRoutes } from './routes/pty-ws.js'
import { createAgentService } from '../agentic/agent-service.js'
import { createOpenAiProvider } from '../agentic/providers/openai-provider.js'
import { registerAgentSessionsRoutes, getSessionEmitter, getSessionBook } from './routes/agent-sessions.js'
import { registerAgentWsRoute } from './routes/agent-ws.js'
import { createTraceStore } from '../agentic/trace-store.js'
import { openDatabase } from '../db/client.js'
import type { AgentService } from '../agentic/agent-service.js'
import type Database from 'better-sqlite3'

export interface BuildServerOptions {
  /** Override the agent service (used in tests; if omitted, a real OpenAI-backed service is created). */
  agentService?: AgentService
  /** Override the database (used in tests; if omitted, the default DB path is used). */
  db?: Database.Database
}

export async function buildServer(opts: BuildServerOptions = {}) {
  const app = Fastify()
  app.get('/health', async () => ({ ok: true }))
  await registerTaskRoutes(app)
  await registerTaskStreamRoutes(app)
  await registerBookRoutes(app)
  await registerChapterRoutes(app)
  await registerChapterContentRoutes(app)
  await registerSessionRoutes(app)
  await registerActionRoutes(app)
  await registerReviewCheckpointRoutes(app)
  await registerMarketScanRoutes(app)
  await registerAccountRoutes(app)
  await registerStorySetupRoutes(app)
  await app.register(websocket)
  await registerPtyWsRoutes(app)

  // Register agent sessions route with a real OpenAI-backed service when running as a server,
  // or skip it when no agent service is provided (e.g. most existing tests).
  if (opts.agentService !== undefined) {
    const db = opts.db ?? openDatabase(process.env.WORKBENCH_DB ?? 'data/workbench.sqlite')
    registerAgentSessionsRoutes(app, { db, service: opts.agentService })
    registerAgentWsRoute(app, {
      getSessionEmitter,
      getSessionTraceId: (sessionId) => {
        const bookId = getSessionBook(sessionId)
        if (!bookId) return undefined
        return opts.agentService!.get(bookId)?.traceId
      },
      traceStore: createTraceStore(db),
    })
  } else if (typeof window === 'undefined' && process.env.NODE_ENV !== 'test') {
    // Real server startup: create OpenAI-backed service
    const db = openDatabase(process.env.WORKBENCH_DB ?? 'data/workbench.sqlite')
    const provider = createOpenAiProvider({
      apiKey: process.env.OPENAI_API_KEY ?? '',
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    const agentService = createAgentService({
      db,
      provider,
      model: process.env.AGENT_DEFAULT_MODEL ?? 'gpt-5.4-mini',
      maxConcurrent: Number(process.env.AGENT_MAX_CONCURRENT_BOOKS ?? 5),
    })
    registerAgentSessionsRoutes(app, { db, service: agentService })
    registerAgentWsRoute(app, {
      getSessionEmitter,
      getSessionTraceId: (sessionId) => {
        const bookId = getSessionBook(sessionId)
        if (!bookId) return undefined
        return agentService.get(bookId)?.traceId
      },
      traceStore: createTraceStore(db),
    })
  }

  return app
}

const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''))
if (isMainModule) {
  const app = await buildServer()
  await app.listen({ port: 4400, host: '127.0.0.1' })
  console.log('Server listening on http://127.0.0.1:4400')
}
