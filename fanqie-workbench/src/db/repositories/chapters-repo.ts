import type Database from 'better-sqlite3'
import type { ChapterRecord, ChapterStage } from '../../domain/chapter.js'

type ChapterRow = {
  id: string
  book_id: string
  chapter_number: number
  title: string
  source_path: string
  stage: ChapterStage
  remote_id: string | null
}

function mapChapterRow(row: ChapterRow): ChapterRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterNumber: row.chapter_number,
    title: row.title,
    sourcePath: row.source_path,
    stage: row.stage,
    remoteId: row.remote_id,
  }
}

export function getChaptersByBookId(db: Database.Database, bookId: string): ChapterRecord[] {
  const rows = db.prepare(
    'SELECT id, book_id, chapter_number, title, source_path, stage, remote_id FROM chapters WHERE book_id = ? ORDER BY chapter_number'
  ).all(bookId) as ChapterRow[]

  return rows.map(mapChapterRow)
}

export function updateChapterRemoteId(db: Database.Database, chapterId: string, remoteId: string | null) {
  db.prepare('UPDATE chapters SET remote_id = ? WHERE id = ?').run(remoteId, chapterId)
}

export function updateChapterStage(db: Database.Database, chapterId: string, stage: ChapterStage) {
  db.prepare('UPDATE chapters SET stage = ? WHERE id = ?').run(stage, chapterId)
}
