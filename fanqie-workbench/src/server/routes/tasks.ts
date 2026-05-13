import type { FastifyInstance } from 'fastify'

export async function registerTaskRoutes(app: FastifyInstance) {
  app.post('/api/tasks', async (_request, reply) => {
    return reply.code(202).send({ accepted: true })
  })

  app.get('/api/tasks', async () => {
    return { tasks: [] }
  })
}
