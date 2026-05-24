import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../../db/client.js'
import {
  getPendingReviewCheckpointBySessionId,
  getReviewCheckpointById,
  resolveReviewCheckpoint,
  type ReviewCheckpointOption,
} from '../../db/repositories/review-checkpoints-repo.js'
import { updateSessionStatus } from '../../db/repositories/sessions-repo.js'
import { getNextChapterId, startChapterActionSession } from '../chapter-action-service.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

const supportedActions: ReviewCheckpointOption[] = ['accept', 'deslop', 'rewrite', 'continue-next', 'save-only']

export async function registerReviewCheckpointRoutes(app: FastifyInstance) {
  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/review-checkpoint', async (request) => {
    const db = openDatabase(getDatabasePath())
    try {
      const checkpoint = getPendingReviewCheckpointBySessionId(db, request.params.sessionId)
      return { checkpoint }
    } finally {
      db.close()
    }
  })

  app.post<{
    Params: { checkpointId: string }
    Body: { action?: ReviewCheckpointOption; comment?: string }
  }>('/api/review-checkpoints/:checkpointId/resolve', async (request, reply) => {
    const { action, comment } = request.body || {}
    if (!action) return reply.code(400).send({ error: 'action is required' })
    if (!supportedActions.includes(action)) return reply.code(400).send({ error: 'unsupported review action' })

    const db = openDatabase(getDatabasePath())
    try {
      const checkpoint = getReviewCheckpointById(db, request.params.checkpointId)
      if (!checkpoint) return reply.code(404).send({ error: 'checkpoint not found' })
      if (checkpoint.status !== 'pending') return reply.code(409).send({ error: 'checkpoint is not pending' })
      if (!checkpoint.chapterId) return reply.code(400).send({ error: 'checkpoint has no chapter' })

      if (action === 'accept') {
        const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'accepted')
        updateSessionStatus(db, checkpoint.sessionId, 'succeeded')
        return { checkpoint: resolved }
      }

      if (action === 'save-only') {
        const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'dismissed')
        updateSessionStatus(db, checkpoint.sessionId, 'succeeded')
        return { checkpoint: resolved }
      }

      if (action === 'continue-next') {
        const currentChapter = db.prepare('SELECT chapter_number FROM chapters WHERE id = ? AND book_id = ?')
          .get(checkpoint.chapterId, checkpoint.bookId) as { chapter_number: number } | undefined
        if (!currentChapter) return reply.code(404).send({ error: 'chapter not found' })
        const nextChapterId = getNextChapterId(db, { bookId: checkpoint.bookId, chapterNumber: currentChapter.chapter_number })
        if (!nextChapterId) return reply.code(400).send({ error: '没有下一章，请先创建章节或选择其他操作' })

        const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'accepted')
        updateSessionStatus(db, checkpoint.sessionId, 'succeeded')
        const next = startChapterActionSession({
          db,
          databasePath: getDatabasePath(),
          actionKey: 'chapter.continue',
          bookId: checkpoint.bookId,
          chapterId: nextChapterId,
        })
        return { checkpoint: resolved, session: next.session }
      }

      const actionKey = action === 'deslop' ? 'chapter.deslop' : 'chapter.rewrite'
      const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'resolved-action')
      updateSessionStatus(db, checkpoint.sessionId, 'succeeded')
      const next = startChapterActionSession({
        db,
        databasePath: getDatabasePath(),
        actionKey,
        bookId: checkpoint.bookId,
        chapterId: checkpoint.chapterId,
        userHint: comment,
      })
      return { checkpoint: resolved, session: next.session }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'chapter not found') return reply.code(404).send({ error: message })
      return reply.code(400).send({ error: message })
    } finally {
      db.close()
    }
  })
}
