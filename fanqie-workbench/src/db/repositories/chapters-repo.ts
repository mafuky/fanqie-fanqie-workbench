import type Database from 'better-sqlite3'
import type { ChapterRecord, ChapterStage } from '../../domain/chapter.js'
import { stageRank } from '../../domain/chapter.js'

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

/**
 * Advance a chapter's stage forward-only: writes `to` only if it is strictly later
 * than the chapter's current stage. Never regresses (re-running a draft won't undo
 * a 已审稿). Returns the resulting stage, or null if the chapter doesn't exist.
 */
export function advanceChapterStage(
  db: Database.Database,
  chapterId: string,
  to: ChapterStage,
): ChapterStage | null {
  const row = db.prepare('SELECT stage FROM chapters WHERE id = ?').get(chapterId) as
    | { stage: ChapterStage }
    | undefined
  if (!row) return null
  if (stageRank(to) <= stageRank(row.stage)) return row.stage
  db.prepare('UPDATE chapters SET stage = ? WHERE id = ?').run(to, chapterId)
  return to
}
