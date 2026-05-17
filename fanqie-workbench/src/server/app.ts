import Fastify from 'fastify'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerTaskStreamRoutes } from './routes/task-stream.js'
import { registerBookRoutes } from './routes/books.js'
import { registerChapterRoutes } from './routes/chapters.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerAccountRoutes } from './routes/accounts.js'
import { registerStorySetupRoutes } from './routes/story-setup.js'

export async function buildServer() {
  const app = Fastify()
  app.get('/health', async () => ({ ok: true }))
  await registerTaskRoutes(app)
  await registerTaskStreamRoutes(app)
  await registerBookRoutes(app)
  await registerChapterRoutes(app)
  await registerSessionRoutes(app)
  await registerAccountRoutes(app)
  await registerStorySetupRoutes(app)
  return app
}

const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''))
if (isMainModule) {
  const app = await buildServer()
  await app.listen({ port: 4310, host: '127.0.0.1' })
  console.log('Server listening on http://127.0.0.1:4310')
}
