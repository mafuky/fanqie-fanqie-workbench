import type Database from 'better-sqlite3'

export interface CreateTraceInput {
  bookId: string
  chapterId: string | null
  actionKey: string
  sessionId: string
  model: string
}

export interface TraceRecord {
  id: number
  bookId: string
  chapterId: string | null
  actionKey: string
  sessionId: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt: number
  endedAt: number | null
  totalPromptTokens: number
  totalCompletionTokens: number
  model: string | null
}

export interface TraceEvent {
  id: number
  phase: string
  eventType: string
  payload: unknown
  createdAt: number
}

export interface TraceStore {
  createTrace(input: CreateTraceInput): number
  appendEvent(traceId: number, ev: { phase: string; eventType: string; payload: unknown }): void
  addUsage(traceId: number, usage: { promptTokens: number; completionTokens: number }): void
  endTrace(traceId: number, status: 'succeeded' | 'failed' | 'cancelled'): void
  getTrace(traceId: number): TraceRecord | null
  listEvents(traceId: number): TraceEvent[]
  listTracesByBook(bookId: string): TraceRecord[]
}

export function createTraceStore(db: Database.Database): TraceStore {
  return {
    createTrace(input) {
      const stmt = db.prepare(`INSERT INTO agent_traces (book_id, chapter_id, action_key, session_id, status, started_at, model) VALUES (?, ?, ?, ?, 'running', ?, ?)`)
      const info = stmt.run(input.bookId, input.chapterId, input.actionKey, input.sessionId, Date.now(), input.model)
      return Number(info.lastInsertRowid)
    },
    appendEvent(traceId, ev) {
      db.prepare(`INSERT INTO agent_trace_events (trace_id, phase_name, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(traceId, ev.phase, ev.eventType, JSON.stringify(ev.payload), Date.now())
    },
    addUsage(traceId, usage) {
      db.prepare(`UPDATE agent_traces SET total_prompt_tokens = total_prompt_tokens + ?, total_completion_tokens = total_completion_tokens + ? WHERE id = ?`)
        .run(usage.promptTokens, usage.completionTokens, traceId)
    },
    endTrace(traceId, status) {
      db.prepare(`UPDATE agent_traces SET status = ?, ended_at = ? WHERE id = ?`)
        .run(status, Date.now(), traceId)
    },
    getTrace(traceId) {
      const row: any = db.prepare(`SELECT * FROM agent_traces WHERE id = ?`).get(traceId)
      return row ? rowToRecord(row) : null
    },
    listEvents(traceId) {
      const rows: any[] = db.prepare(`SELECT * FROM agent_trace_events WHERE trace_id = ? ORDER BY id ASC`).all(traceId)
      return rows.map((r) => ({
        id: r.id,
        phase: r.phase_name,
        eventType: r.event_type,
        payload: JSON.parse(r.payload_json),
        createdAt: r.created_at,
      }))
    },
    listTracesByBook(bookId) {
      const rows: any[] = db.prepare(`SELECT * FROM agent_traces WHERE book_id = ? ORDER BY started_at DESC`).all(bookId)
      return rows.map(rowToRecord)
    },
  }
}

function rowToRecord(row: any): TraceRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    actionKey: row.action_key,
    sessionId: row.session_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    totalPromptTokens: row.total_prompt_tokens,
    totalCompletionTokens: row.total_completion_tokens,
    model: row.model,
  }
}
