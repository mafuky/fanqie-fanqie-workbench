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

export async function buildServer() {
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
  return app
}

const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''))
if (isMainModule) {
  const app = await buildServer()
  await app.listen({ port: 4400, host: '127.0.0.1' })
  console.log('Server listening on http://127.0.0.1:4400')
}
