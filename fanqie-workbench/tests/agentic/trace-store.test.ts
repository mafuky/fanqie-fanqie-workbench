import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}

describe('TraceStore', () => {
  it('creates trace and appends events', () => {
    const db = memDb()
    const store = createTraceStore(db)
    const traceId = store.createTrace({ bookId: 'b1', chapterId: 'c1', actionKey: 'chapter.continue', sessionId: 's1', model: 'gpt-5' })
    store.appendEvent(traceId, { phase: 'load-context', eventType: 'phase-start', payload: {} })
    store.appendEvent(traceId, { phase: 'load-context', eventType: 'tool-call', payload: { name: 'read_file' } })
    const events = store.listEvents(traceId)
    expect(events).toHaveLength(2)
    expect(events[0].eventType).toBe('phase-start')
  })

  it('updates usage and ends trace', () => {
    const db = memDb()
    const store = createTraceStore(db)
    const traceId = store.createTrace({ bookId: 'b1', chapterId: null, actionKey: 'chapter.continue', sessionId: 's1', model: 'gpt-5' })
    store.addUsage(traceId, { promptTokens: 100, completionTokens: 50 })
    store.addUsage(traceId, { promptTokens: 20, completionTokens: 10 })
    store.endTrace(traceId, 'succeeded')
    const trace = store.getTrace(traceId)
    expect(trace?.totalPromptTokens).toBe(120)
    expect(trace?.totalCompletionTokens).toBe(60)
    expect(trace?.status).toBe('succeeded')
    expect(trace?.endedAt).toBeTruthy()
  })

  it('lists traces for a book ordered by recency', () => {
    const db = memDb()
    const store = createTraceStore(db)
    store.createTrace({ bookId: 'b1', chapterId: null, actionKey: 'chapter.continue', sessionId: 's1', model: 'gpt-5' })
    store.createTrace({ bookId: 'b1', chapterId: null, actionKey: 'chapter.continue', sessionId: 's2', model: 'gpt-5' })
    const list = store.listTracesByBook('b1')
    expect(list).toHaveLength(2)
  })
})
