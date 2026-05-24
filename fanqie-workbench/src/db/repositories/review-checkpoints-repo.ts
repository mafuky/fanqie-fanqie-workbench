import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type ReviewCheckpointStage = 'chapter-complete'
export type ReviewCheckpointStatus = 'pending' | 'accepted' | 'resolved-action' | 'dismissed' | 'superseded'
export type ReviewCheckpointOption = 'accept' | 'deslop' | 'rewrite' | 'continue-next' | 'save-only'

export type ReviewCheckpointSummary = {
  completed: string[]
  checks: string[]
}

export type ReviewCheckpointRecord = {
  id: string
  sessionId: string
  bookId: string
  chapterId: string | null
  stage: ReviewCheckpointStage
  title: string
  summary: ReviewCheckpointSummary
  changedFiles: string[]
  options: ReviewCheckpointOption[]
  status: ReviewCheckpointStatus
  createdAt: string
  resolvedAt: string | null
}

type ReviewCheckpointRow = {
  id: string
  session_id: string
  book_id: string
  chapter_id: string | null
  stage: ReviewCheckpointStage
  title: string
  summary_json: string
  changed_files_json: string
  options_json: string
  status: ReviewCheckpointStatus
  created_at: string
  resolved_at: string | null
}

function parseJsonArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.map(String) : []
}

function parseSummary(value: string): ReviewCheckpointSummary {
  const parsed = JSON.parse(value) as Partial<ReviewCheckpointSummary>
  return {
    completed: Array.isArray(parsed.completed) ? parsed.completed.map(String) : [],
    checks: Array.isArray(parsed.checks) ? parsed.checks.map(String) : [],
  }
}

function mapReviewCheckpointRow(row: ReviewCheckpointRow): ReviewCheckpointRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    stage: row.stage,
    title: row.title,
    summary: parseSummary(row.summary_json),
    changedFiles: parseJsonArray(row.changed_files_json),
    options: parseJsonArray(row.options_json) as ReviewCheckpointOption[],
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }
}

export function createReviewCheckpoint(db: Database.Database, input: {
  sessionId: string
  bookId: string
  chapterId?: string | null
  stage: ReviewCheckpointStage
  title: string
  summary: ReviewCheckpointSummary
  changedFiles: string[]
  options: ReviewCheckpointOption[]
}): ReviewCheckpointRecord {
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO review_checkpoints (
      id, session_id, book_id, chapter_id, stage, title,
      summary_json, changed_files_json, options_json, status, created_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
  ).run(
    id,
    input.sessionId,
    input.bookId,
    input.chapterId ?? null,
    input.stage,
    input.title,
    JSON.stringify(input.summary),
    JSON.stringify(input.changedFiles),
    JSON.stringify(input.options),
    now,
  )

  return {
    id,
    sessionId: input.sessionId,
    bookId: input.bookId,
    chapterId: input.chapterId ?? null,
    stage: input.stage,
    title: input.title,
    summary: input.summary,
    changedFiles: input.changedFiles,
    options: input.options,
    status: 'pending',
    createdAt: now,
    resolvedAt: null,
  }
}

export function getReviewCheckpointById(db: Database.Database, id: string): ReviewCheckpointRecord | null {
  const row = db.prepare(
    `SELECT id, session_id, book_id, chapter_id, stage, title, summary_json,
            changed_files_json, options_json, status, created_at, resolved_at
     FROM review_checkpoints
     WHERE id = ?`,
  ).get(id) as ReviewCheckpointRow | undefined
  return row ? mapReviewCheckpointRow(row) : null
}

export function getPendingReviewCheckpointBySessionId(db: Database.Database, sessionId: string): ReviewCheckpointRecord | null {
  const row = db.prepare(
    `SELECT id, session_id, book_id, chapter_id, stage, title, summary_json,
            changed_files_json, options_json, status, created_at, resolved_at
     FROM review_checkpoints
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get(sessionId) as ReviewCheckpointRow | undefined
  return row ? mapReviewCheckpointRow(row) : null
}

export function resolveReviewCheckpoint(db: Database.Database, id: string, status: Exclude<ReviewCheckpointStatus, 'pending'>): ReviewCheckpointRecord | null {
  db.prepare('UPDATE review_checkpoints SET status = ?, resolved_at = ? WHERE id = ? AND status = \'pending\'').run(
    status,
    new Date().toISOString(),
    id,
  )
  return getReviewCheckpointById(db, id)
}
