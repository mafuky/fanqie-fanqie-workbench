import type { FastifyInstance } from 'fastify'
import { readFile } from 'node:fs/promises'
import { openDatabase } from '../../db/client.js'
import type { ChapterStage } from '../../domain/chapter.js'

const DB_PATH = process.env.WORKBENCH_DB || 'data/workbench.sqlite'

export async function registerChapterContentRoutes(app: FastifyInstance) {
  app.get<{
    Params: { chapterId: string }
  }>('/api/chapters/:chapterId/content', async (request, reply) => {
    const { chapterId } = request.params
    const db = openDatabase(DB_PATH)
    const chapter = db.prepare(
      `SELECT c.id, c.chapter_number, c.title, c.source_path, c.stage, c.book_id,
              b.title AS book_title
       FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE c.id = ?`,
    ).get(chapterId) as {
      id: string
      chapter_number: number
      title: string
      source_path: string
      stage: ChapterStage
      book_id: string
      book_title: string
    } | undefined

    if (!chapter) {
      db.close()
      return reply.code(404).send({ error: 'chapter not found' })
    }

    const siblings = db.prepare(
      'SELECT id, chapter_number FROM chapters WHERE book_id = ? ORDER BY chapter_number',
    ).all(chapter.book_id) as Array<{ id: string; chapter_number: number }>
    db.close()

    const index = siblings.findIndex((s) => s.id === chapterId)
    const prev = index > 0 ? siblings[index - 1] : null
    const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null

    let content = ''
    try {
      content = await readFile(chapter.source_path, 'utf8')
    } catch (error) {
      return reply.code(500).send({
        error: `failed to read chapter file: ${error instanceof Error ? error.message : String(error)}`,
      })
    }

    const wordCount = content.replace(/\s+/g, '').length

    return {
      id: chapter.id,
      chapterNumber: chapter.chapter_number,
      title: chapter.title,
      stage: chapter.stage,
      bookId: chapter.book_id,
      bookTitle: chapter.book_title,
      content,
      wordCount,
      sourcePath: chapter.source_path,
      prevChapterId: prev?.id ?? null,
      nextChapterId: next?.id ?? null,
    }
  })
}
