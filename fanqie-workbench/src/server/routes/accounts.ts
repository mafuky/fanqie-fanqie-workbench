import type { FastifyInstance } from 'fastify'

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async () => ({ accounts: [] }))

  app.post('/api/accounts', async (_request, reply) => {
    return reply.code(201).send({ created: true })
  })

  app.post('/api/accounts/:id/login-session', async (_request, reply) => {
    return reply.code(202).send({ browserOpened: true })
  })

  app.post('/api/accounts/:id/capture-session', async (_request, reply) => {
    return reply.send({ captured: true })
  })

  app.post('/api/accounts/:id/check-health', async (_request, reply) => {
    return reply.send({ status: 'active' })
  })

  app.delete('/api/accounts/:id', async (_request, reply) => {
    return reply.code(204).send()
  })
}
