import type { FastifyInstance } from 'fastify'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { openDatabase } from '../../db/client.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

function isPathInside(parent: string, child: string) {
  const rel = relative(parent, child)
  return rel.length > 0 && !rel.startsWith('..') && !rel.startsWith('/')
}

type ChapterContentRow = {
  id: string
  title: string
  chapter_number: number
  source_path: string
  book_id: string
  root_path: string
}

function getChapterContentRow(chapterId: string) {
  const db = openDatabase(getDatabasePath())
  try {
    return db.prepare(
      `SELECT c.id, c.title, c.chapter_number, c.source_path, c.book_id, b.root_path
       FROM chapters c
       JOIN books b ON b.id = c.book_id
       WHERE c.id = ?`,
    ).get(chapterId) as ChapterContentRow | undefined
  } finally {
    db.close()
  }
}

function assertSafeChapterPath(row: ChapterContentRow) {
  const rootPath = resolve(row.root_path)
  const sourcePath = resolve(row.source_path)
  if (!isPathInside(rootPath, sourcePath)) {
    return 'chapter source path must be inside book root'
  }
  if (extname(sourcePath) !== '.md') {
    return 'chapter source path must be a markdown file'
  }
  return null
}

function hasRunningClaudeSession(bookId: string) {
  const db = openDatabase(getDatabasePath())
  try {
    const row = db.prepare(
      `SELECT id
       FROM sessions
       WHERE book_id = ?
         AND kind = 'chapter'
         AND status IN ('running', 'waiting-answer')
       LIMIT 1`,
    ).get(bookId)
    return !!row
  } finally {
    db.close()
  }
}

function toResponseChapter(row: ChapterContentRow) {
  return {
    id: row.id,
    title: row.title,
    chapterNumber: row.chapter_number,
    sourcePath: resolve(row.source_path),
  }
}

export async function registerChapterContentRoutes(app: FastifyInstance) {
  app.get<{ Params: { chapterId: string } }>('/api/chapters/:chapterId/content', async (request, reply) => {
    const row = getChapterContentRow(request.params.chapterId)
    if (!row) return reply.code(404).send({ error: 'chapter not found' })

    const safetyError = assertSafeChapterPath(row)
    if (safetyError) return reply.code(400).send({ error: safetyError })

    const content = await readFile(resolve(row.source_path), 'utf8')
    return { chapter: toResponseChapter(row), content }
  })

  app.put<{ Params: { chapterId: string }; Body: { content?: string } }>('/api/chapters/:chapterId/content', async (request, reply) => {
    const content = request.body?.content
    if (typeof content !== 'string') return reply.code(400).send({ error: 'content is required' })

    const row = getChapterContentRow(request.params.chapterId)
    if (!row) return reply.code(404).send({ error: 'chapter not found' })

    const safetyError = assertSafeChapterPath(row)
    if (safetyError) return reply.code(400).send({ error: safetyError })

    if (hasRunningClaudeSession(row.book_id)) {
      return reply.code(409).send({ error: 'chapter is being modified by a running Claude session' })
    }

    await writeFile(resolve(row.source_path), content, 'utf8')
    return { saved: true }
  })
}
