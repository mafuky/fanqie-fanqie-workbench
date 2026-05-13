import type { FastifyInstance } from 'fastify'

export async function registerBookRoutes(app: FastifyInstance) {
  app.get('/api/books', async () => {
    return { books: [] }
  })

  app.get('/api/books/:bookId', async (request) => {
    const { bookId } = request.params as { bookId: string }
    return { bookId, chapters: [] }
  })
}
