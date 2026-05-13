import Fastify from 'fastify'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerBookRoutes } from './routes/books.js'

export async function buildServer() {
  const app = Fastify()
  app.get('/health', async () => ({ ok: true }))
  await registerTaskRoutes(app)
  await registerBookRoutes(app)
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ port: 4310, host: '127.0.0.1' })
}
