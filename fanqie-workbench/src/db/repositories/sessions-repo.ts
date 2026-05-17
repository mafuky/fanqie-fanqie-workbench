import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type SessionKind = 'prompt' | 'chapter' | 'account-action'
export type SessionStatus = 'running' | 'waiting-answer' | 'paused' | 'succeeded' | 'failed'

export type SessionRecord = {
  id: string
  kind: SessionKind
  bookId: string | null
  chapterId: string | null
  status: SessionStatus
  currentSkill: string | null
  pendingQuestionJson: string | null
  claudeResumeId: string | null
  compressedAt: string | null
  contextSnapshotJson: string | null
  createdAt: string
  updatedAt: string
}

export type SessionMessageRecord = {
  id: number
  sessionId: string
  role: string
  stream: string | null
  content: string
  createdAt: string
}

type SessionRow = {
  id: string
  kind: SessionKind
  book_id: string | null
  chapter_id: string | null
  status: SessionStatus
  current_skill: string | null
  pending_question_json: string | null
  claude_resume_id: string | null
  compressed_at: string | null
  context_snapshot_json: string | null
  created_at: string
  updated_at: string
}

type SessionMessageRow = {
  id: number
  session_id: string
  role: string
  stream: string | null
  content: string
  created_at: string
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    kind: row.kind,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    status: row.status,
    currentSkill: row.current_skill,
    pendingQuestionJson: row.pending_question_json,
    claudeResumeId: row.claude_resume_id,
    compressedAt: row.compressed_at,
    contextSnapshotJson: row.context_snapshot_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSessionMessageRow(row: SessionMessageRow): SessionMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    stream: row.stream,
    content: row.content,
    createdAt: row.created_at,
  }
}

export function createSession(db: Database.Database, input: {
  kind: SessionKind
  bookId?: string | null
  chapterId?: string | null
  status?: SessionStatus
  currentSkill?: string | null
  pendingQuestionJson?: string | null
  claudeResumeId?: string | null
  compressedAt?: string | null
  contextSnapshotJson?: string | null
}): SessionRecord {
  const id = randomUUID()
  const now = new Date().toISOString()
  const status = input.status ?? 'running'

  db.prepare(
    `INSERT INTO sessions (
      id,
      kind,
      book_id,
      chapter_id,
      status,
      current_skill,
      pending_question_json,
      claude_resume_id,
      compressed_at,
      context_snapshot_json,
      created_at,
      updated_at
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.kind,
    input.bookId ?? null,
    input.chapterId ?? null,
    status,
    input.currentSkill ?? null,
    input.pendingQuestionJson ?? null,
    input.claudeResumeId ?? null,
    input.compressedAt ?? null,
    input.contextSnapshotJson ?? null,
    now,
    now,
  )

  return {
    id,
    kind: input.kind,
    bookId: input.bookId ?? null,
    chapterId: input.chapterId ?? null,
    status,
    currentSkill: input.currentSkill ?? null,
    pendingQuestionJson: input.pendingQuestionJson ?? null,
    claudeResumeId: input.claudeResumeId ?? null,
    compressedAt: input.compressedAt ?? null,
    contextSnapshotJson: input.contextSnapshotJson ?? null,
    createdAt: now,
    updatedAt: now,
  }
}

export function getSessionById(db: Database.Database, id: string): SessionRecord | null {
  const row = db.prepare(
    'SELECT id, kind, book_id, chapter_id, status, current_skill, pending_question_json, claude_resume_id, compressed_at, context_snapshot_json, created_at, updated_at FROM sessions WHERE id = ?'
  ).get(id) as SessionRow | undefined
  return row ? mapSessionRow(row) : null
}

export function findBookMasterSession(db: Database.Database, bookId: string): SessionRecord | null {
  const row = db.prepare(
    `SELECT id, kind, book_id, chapter_id, status, current_skill, pending_question_json, claude_resume_id, compressed_at, context_snapshot_json, created_at, updated_at
     FROM sessions
     WHERE kind = 'prompt' AND book_id = ? AND current_skill = 'book-master-session'
     ORDER BY updated_at DESC
     LIMIT 1`
  ).get(bookId) as SessionRow | undefined
  return row ? mapSessionRow(row) : null
}

export function listSessionsByKind(db: Database.Database, kind: SessionKind): SessionRecord[] {
  const rows = db.prepare(
    'SELECT id, kind, book_id, chapter_id, status, current_skill, pending_question_json, claude_resume_id, compressed_at, context_snapshot_json, created_at, updated_at FROM sessions WHERE kind = ? ORDER BY created_at DESC LIMIT 50'
  ).all(kind) as SessionRow[]
  return rows.map(mapSessionRow)
}

export function updateSessionStatus(
  db: Database.Database,
  id: string,
  status: SessionStatus,
  currentSkill?: string | null,
) {
  const now = new Date().toISOString()
  if (currentSkill !== undefined) {
    db.prepare('UPDATE sessions SET status = ?, current_skill = ?, updated_at = ? WHERE id = ?').run(
      status,
      currentSkill,
      now,
      id,
    )
    return
  }

  db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    now,
    id,
  )
}

export function updateSessionMetadata(
  db: Database.Database,
  id: string,
  patch: { claudeResumeId?: string | null; compressedAt?: string | null; contextSnapshotJson?: string | null },
) {
  const current = getSessionById(db, id)
  if (!current) return
  db.prepare(
    'UPDATE sessions SET claude_resume_id = ?, compressed_at = ?, context_snapshot_json = ?, updated_at = ? WHERE id = ?'
  ).run(
    patch.claudeResumeId !== undefined ? patch.claudeResumeId : current.claudeResumeId,
    patch.compressedAt !== undefined ? patch.compressedAt : current.compressedAt,
    patch.contextSnapshotJson !== undefined ? patch.contextSnapshotJson : current.contextSnapshotJson,
    new Date().toISOString(),
    id,
  )
}

export function updateSessionPendingQuestion(
  db: Database.Database,
  id: string,
  pendingQuestion: { question: string; options: Array<{ label: string; description?: string }> } | null,
) {
  db.prepare('UPDATE sessions SET pending_question_json = ?, updated_at = ? WHERE id = ?').run(
    pendingQuestion ? JSON.stringify(pendingQuestion) : null,
    new Date().toISOString(),
    id,
  )
}

export function appendSessionMessage(
  db: Database.Database,
  sessionId: string,
  input: { role: string; stream?: string | null; content: string },
) {
  const result = db.prepare(
    'INSERT INTO session_messages (session_id, role, stream, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(
    sessionId,
    input.role,
    input.stream ?? null,
    input.content,
    new Date().toISOString(),
  )
  return Number(result.lastInsertRowid)
}

export function getSessionMessages(db: Database.Database, sessionId: string): SessionMessageRecord[] {
  const rows = db.prepare(
    'SELECT id, session_id, role, stream, content, created_at FROM session_messages WHERE session_id = ? ORDER BY id'
  ).all(sessionId) as SessionMessageRow[]
  return rows.map(mapSessionMessageRow)
}
