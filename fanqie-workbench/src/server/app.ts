import Fastify from 'fastify'

export async function buildServer() {
  const app = Fastify()
  app.get('/health', async () => ({ ok: true }))
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer()
  await app.listen({ port: 4310, host: '127.0.0.1' })
}
