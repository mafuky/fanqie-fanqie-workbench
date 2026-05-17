import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../../db/client.js'
import { submitAnswer } from '../../claude/stream-capture.js'
import { canTransition, type ChapterStage } from '../../domain/chapter.js'

const DB_PATH = process.env.WORKBENCH_DB || 'data/workbench.sqlite'

export async function registerChapterRoutes(app: FastifyInstance) {
  app.post<{
    Params: { chapterId: string }
    Body: { targetStage?: ChapterStage; userHint?: string }
  }>('/api/chapters/:chapterId/process', async (_request, reply) => {
    return reply.code(409).send({
      error: 'Use /api/sessions with kind=chapter so the request runs through the Claude terminal runtime',
    })
  })

  // Answer a pending question
  app.post<{
    Params: { taskId: string }
    Body: { answer: string }
  }>('/api/tasks/:taskId/answer', async (request, reply) => {
    const { taskId } = request.params
    const { answer } = request.body || {} as any

    if (!answer) return reply.code(400).send({ error: 'answer is required' })

    const ok = submitAnswer(taskId, answer)
    if (!ok) return reply.code(404).send({ error: 'no pending question for this task' })

    return { answered: true }
  })

  // Batch process
  app.post<{
    Params: { bookId: string }
    Body: { targetStage?: ChapterStage; chapterIds?: string[] }
  }>('/api/books/:bookId/process', async (request, reply) => {
    const { bookId } = request.params
    const { targetStage = '可发布', chapterIds } = request.body || {} as any

    const db = openDatabase(DB_PATH)
    let chapters: any[]

    if (chapterIds && chapterIds.length > 0) {
      const placeholders = chapterIds.map(() => '?').join(',')
      chapters = db.prepare(
        `SELECT id, chapter_number, title, stage FROM chapters WHERE book_id = ? AND id IN (${placeholders}) ORDER BY chapter_number`
      ).all(bookId, ...chapterIds)
    } else {
      chapters = db.prepare(
        'SELECT id, chapter_number, title, stage FROM chapters WHERE book_id = ? AND stage != ? ORDER BY chapter_number'
      ).all(bookId, targetStage)
    }

    db.close()

    return {
      bookId, targetStage,
      chapters: chapters.map((c: any) => ({
        id: c.id, chapterNumber: c.chapter_number, title: c.title, currentStage: c.stage,
      })),
    }
  })

  app.post<{
    Params: { chapterId: string }
    Body: { targetStage: ChapterStage }
  }>('/api/chapters/:chapterId/confirm-stage', async (request, reply) => {
    const { chapterId } = request.params
    const { targetStage } = request.body || {} as any

    if (!targetStage) return reply.code(400).send({ error: 'targetStage is required' })

    const db = openDatabase(DB_PATH)
    const chapter = db.prepare('SELECT id, stage FROM chapters WHERE id = ?').get(chapterId) as { id: string; stage: ChapterStage } | undefined

    if (!chapter) {
      db.close()
      return reply.code(404).send({ error: 'chapter not found' })
    }

    if (!canTransition(chapter.stage, targetStage)) {
      db.close()
      return reply.code(400).send({ error: `Cannot confirm stage from ${chapter.stage} to ${targetStage}` })
    }

    db.prepare('UPDATE chapters SET stage = ? WHERE id = ?').run(targetStage, chapterId)
    db.close()
    return { chapterId, previousStage: chapter.stage, currentStage: targetStage }
  })

  // Rollback chapter stage
  app.post<{
    Params: { chapterId: string }
    Body: { targetStage: ChapterStage }
  }>('/api/chapters/:chapterId/rollback', async (request, reply) => {
    const { chapterId } = request.params
    const { targetStage } = request.body || {} as any

    if (!targetStage) return reply.code(400).send({ error: 'targetStage is required' })

    const db = openDatabase(DB_PATH)
    const chapter = db.prepare('SELECT id, stage FROM chapters WHERE id = ?').get(chapterId) as any

    if (!chapter) { db.close(); return reply.code(404).send({ error: 'chapter not found' }) }

    if (!canTransition(chapter.stage, targetStage)) {
      db.close()
      return reply.code(400).send({ error: `Cannot rollback from ${chapter.stage} to ${targetStage}` })
    }

    db.prepare('UPDATE chapters SET stage = ? WHERE id = ?').run(targetStage, chapterId)
    db.close()
    return { chapterId, previousStage: chapter.stage, currentStage: targetStage }
  })
}
