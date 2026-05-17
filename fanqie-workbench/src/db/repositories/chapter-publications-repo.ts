import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ChapterPublicationRecord, ChapterPublicationStatus } from '../../domain/publication.js'

type ChapterPublicationRow = {
  id: string
  chapter_id: string
  book_publication_id: string
  platform_chapter_id: string | null
  status: ChapterPublicationStatus
  last_published_at: string | null
  updated_at: string
}

function mapChapterPublicationRow(row: ChapterPublicationRow): ChapterPublicationRecord {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    bookPublicationId: row.book_publication_id,
    platformChapterId: row.platform_chapter_id,
    status: row.status,
    lastPublishedAt: row.last_published_at,
    updatedAt: row.updated_at,
  }
}

export function upsertChapterPublication(
  db: Database.Database,
  input: {
    chapterId: string
    bookPublicationId: string
    platformChapterId: string | null
    status: ChapterPublicationStatus
  },
) {
  const existing = db.prepare(
    `SELECT id, last_published_at FROM chapter_publications WHERE chapter_id = ? AND book_publication_id = ?`,
  ).get(input.chapterId, input.bookPublicationId) as { id: string; last_published_at: string | null } | undefined
  const updatedAt = new Date().toISOString()
  const lastPublishedAt = input.status === 'published' ? updatedAt : null

  if (existing) {
    const nextLastPublishedAt = input.status === 'published' ? updatedAt : existing.last_published_at

    db.prepare(
      `UPDATE chapter_publications
       SET platform_chapter_id = ?, status = ?, last_published_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.platformChapterId, input.status, nextLastPublishedAt, updatedAt, existing.id)
    return
  }

  db.prepare(
    `INSERT INTO chapter_publications (id, chapter_id, book_publication_id, platform_chapter_id, status, last_published_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), input.chapterId, input.bookPublicationId, input.platformChapterId, input.status, lastPublishedAt, updatedAt)
}

export function getChapterPublicationsByBookPublicationId(
  db: Database.Database,
  bookPublicationId: string,
): ChapterPublicationRecord[] {
  const rows = db.prepare(
    `SELECT id, chapter_id, book_publication_id, platform_chapter_id, status, last_published_at, updated_at
     FROM chapter_publications
     WHERE book_publication_id = ?
     ORDER BY updated_at ASC`,
  ).all(bookPublicationId) as ChapterPublicationRow[]

  return rows.map(mapChapterPublicationRow)
}
