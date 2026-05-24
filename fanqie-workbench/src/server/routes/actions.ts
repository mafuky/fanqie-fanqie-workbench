import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../../db/client.js'
import { startChapterActionSession } from '../chapter-action-service.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

export async function registerActionRoutes(app: FastifyInstance) {
  app.post<{ Body: { actionKey?: string; bookId?: string; chapterId?: string; userHint?: string } }>('/api/actions', async (request, reply) => {
    const { actionKey, bookId, chapterId, userHint } = request.body || {}
    if (!actionKey) return reply.code(400).send({ error: 'actionKey is required' })
    if (!bookId) return reply.code(400).send({ error: 'bookId is required' })
    if (!chapterId) return reply.code(400).send({ error: 'chapterId is required' })

    const db = openDatabase(getDatabasePath())
    try {
      const result = startChapterActionSession({
        db,
        databasePath: getDatabasePath(),
        actionKey,
        bookId,
        chapterId,
        userHint,
      })
      return reply.code(201).send({ session: result.session })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'chapter not found') return reply.code(404).send({ error: message })
      return reply.code(400).send({ error: message })
    } finally {
      db.close()
    }
  })
}
