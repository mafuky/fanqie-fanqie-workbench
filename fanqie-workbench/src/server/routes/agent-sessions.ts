import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { AgentService } from '../../agentic/agent-service.js'

export interface AgentSessionsDeps {
  db: Database.Database
  service: AgentService
}

// Module-level Maps exported for the WebSocket route (T24) to look up by sessionId.
// These are populated/cleaned per route registration but are global for WS lookup.
export const sessionEmitters = new Map<string, EventEmitter>()
export const sessionToBook = new Map<string, string>()

export function getSessionEmitter(sessionId: string): EventEmitter | undefined {
  return sessionEmitters.get(sessionId)
}

export function getSessionBook(sessionId: string): string | undefined {
  return sessionToBook.get(sessionId)
}

export function registerAgentSessionsRoutes(app: FastifyInstance, deps: AgentSessionsDeps) {
  // Route-level guard: tracks which bookIds have an active (started-but-not-yet-done) session.
  // This is separate from the pool's internal `active` map so that a route-level "already running"
  // check persists until the emitter fires `done`, regardless of how quickly the pool runner finishes.
  const activeBookIds = new Set<string>()

  app.post<{ Body: { actionKey: string; bookId: string; chapterId: string } }>(
    '/api/agent-sessions',
    async (req, reply) => {
      const { actionKey, bookId, chapterId } = req.body
      if (activeBookIds.has(bookId)) {
        return reply.code(409).send({ error: `book ${bookId} already running` })
      }
      const book: any = deps.db.prepare(`SELECT id, title, root_path FROM books WHERE id = ?`).get(bookId)
      if (!book) return reply.code(404).send({ error: 'book not found' })
      const chapter: any = deps.db.prepare(`SELECT id, book_id, chapter_number, title, source_path, stage FROM chapters WHERE id = ?`).get(chapterId)
      if (!chapter) return reply.code(404).send({ error: 'chapter not found' })
      const sessionId = randomUUID()
      const emitter = new EventEmitter()
      sessionEmitters.set(sessionId, emitter)
      sessionToBook.set(sessionId, bookId)
      activeBookIds.add(bookId)
      emitter.on('event', (ev: any) => {
        if (ev.type === 'done') activeBookIds.delete(bookId)
      })
      try {
        const runner = await deps.service.start({
          actionKey,
          bookMeta: { id: book.id, title: book.title, rootPath: book.root_path },
          chapter: {
            id: chapter.id, chapterNumber: chapter.chapter_number, title: chapter.title,
            sourcePath: chapter.source_path, stage: chapter.stage,
          },
          sessionId, emitter,
        })
        return { sessionId, status: runner.status, traceId: runner.traceId }
      } catch (err: any) {
        sessionEmitters.delete(sessionId)
        sessionToBook.delete(sessionId)
        activeBookIds.delete(bookId)
        if (/already running|concurrent limit/i.test(err.message)) {
          return reply.code(409).send({ error: err.message })
        }
        return reply.code(500).send({ error: err.message })
      }
    },
  )

  app.post<{ Params: { sessionId: string } }>(
    '/api/agent-sessions/:sessionId/cancel',
    async (req, reply) => {
      const bookId = sessionToBook.get(req.params.sessionId)
      if (!bookId) return reply.code(404).send({ error: 'session not found' })
      deps.service.cancel(bookId)
      activeBookIds.delete(bookId)
      return { ok: true }
    },
  )

  app.post<{ Params: { sessionId: string }; Body: { answer: string } }>(
    '/api/agent-sessions/:sessionId/answer',
    async (req, reply) => {
      const bookId = sessionToBook.get(req.params.sessionId)
      if (!bookId) return reply.code(404).send({ error: 'session not found' })
      deps.service.submitAnswer(bookId, req.body.answer)
      return { ok: true }
    },
  )

  app.get<{ Params: { sessionId: string } }>(
    '/api/agent-sessions/:sessionId',
    async (req, reply) => {
      const bookId = sessionToBook.get(req.params.sessionId)
      if (!bookId) return reply.code(404).send({ error: 'session not found' })
      const runner = deps.service.get(bookId)
      return { status: runner?.status ?? 'unknown', currentPhase: runner?.currentPhase ?? null }
    },
  )
}
