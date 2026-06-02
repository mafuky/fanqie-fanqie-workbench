import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
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

  app.post<{ Body: { actionKey: string; bookId: string; chapterId: string; instruction?: string } }>(
    '/api/agent-sessions',
    async (req, reply) => {
      const { actionKey, bookId, chapterId, instruction } = req.body
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
      try {
        const runner = await deps.service.start({
          actionKey,
          bookMeta: { id: book.id, title: book.title, rootPath: book.root_path },
          chapter: {
            id: chapter.id, chapterNumber: chapter.chapter_number, title: chapter.title,
            sourcePath: chapter.source_path, stage: chapter.stage,
          },
          sessionId, emitter,
          onSettled: () => activeBookIds.delete(bookId),
          ...(instruction ? { initialResults: { reviseInstruction: instruction } } : {}),
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

  // Emergency unblock: clear a book's "running" guard without restarting the server
  // (e.g. if a run somehow died without settling). Also cancels any in-flight runner.
  app.post<{ Params: { bookId: string } }>(
    '/api/agent-sessions/release/:bookId',
    async (req) => {
      const { bookId } = req.params
      const released = activeBookIds.delete(bookId)
      deps.service.cancel(bookId)
      return { ok: true, released }
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

  app.post<{ Body: { idea: string } }>(
    '/api/agent-sessions/book-create',
    async (req, reply) => {
      const idea = req.body?.idea?.trim()
      if (!idea) {
        return reply.code(400).send({ error: 'idea is required' })
      }

      const workspaceRoot = process.env.WORKSPACE_ROOT ?? resolvePath(process.cwd(), '..')
      const bookId = randomUUID()
      const placeholderTitle = idea.slice(0, 20)
      const placeholderRoot = `pending:${bookId}`
      deps.db.prepare(`INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)`).run(bookId, placeholderTitle, placeholderRoot)

      const onBookNamed = async (title: string): Promise<{ title: string; rootPath: string }> => {
        const clean = title.replace(/[\\/]/g, ' ').trim() || '新书'
        let finalTitle = clean
        let n = 2
        const titleTaken = (t: string) => {
          const dup = deps.db.prepare(`SELECT id FROM books WHERE title = ? AND id != ?`).get(t, bookId)
          if (dup) return true
          return existsSync(join(workspaceRoot, 'novels', t))
        }
        while (titleTaken(finalTitle)) {
          finalTitle = `${clean}（${n}）`
          n += 1
        }
        const bookRoot = join(workspaceRoot, 'novels', finalTitle)
        await mkdir(bookRoot, { recursive: true })
        deps.db.prepare(`UPDATE books SET title = ?, root_path = ? WHERE id = ?`).run(finalTitle, bookRoot, bookId)
        return { title: finalTitle, rootPath: bookRoot }
      }

      const sessionId = randomUUID()
      const emitter = new EventEmitter()
      sessionEmitters.set(sessionId, emitter)
      sessionToBook.set(sessionId, bookId)
      emitter.on('event', (ev: any) => {
        if (ev.type !== 'done') return
        activeBookIds.delete(bookId)
        const current: any = deps.db.prepare(`SELECT root_path FROM books WHERE id = ?`).get(bookId)
        const stillPending = !current || String(current.root_path).startsWith('pending:')
        if (ev.status === 'succeeded') {
          if (!current || stillPending) return
          try {
            const bookRoot = current.root_path as string
            const existing = deps.db.prepare(`SELECT id FROM chapters WHERE book_id = ? AND chapter_number = ?`).get(bookId, 1)
            if (!existing) {
              const chapterId = randomUUID()
              deps.db.prepare(
                `INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)`,
              ).run(chapterId, bookId, 1, '第一章', join(bookRoot, '正文', '第001章.md'), '待写作')
            }
          } catch (err) {
            console.error('[book-create] failed to insert chapter 1:', err)
          }
        } else {
          if (stillPending) {
            try {
              deps.db.prepare(`DELETE FROM books WHERE id = ?`).run(bookId)
            } catch (err) {
              console.error('[book-create] failed to clean up placeholder row:', err)
            }
          }
        }
      })
      activeBookIds.add(bookId)

      try {
        const runner = await deps.service.start({
          actionKey: 'book.create',
          bookMeta: { id: bookId, title: placeholderTitle, rootPath: placeholderRoot, idea },
          chapter: null,
          sessionId, emitter,
          onBookNamed,
          onSettled: () => activeBookIds.delete(bookId),
        })
        return { sessionId, bookId, status: runner.status, traceId: runner.traceId }
      } catch (err: any) {
        sessionEmitters.delete(sessionId)
        sessionToBook.delete(sessionId)
        activeBookIds.delete(bookId)
        try { deps.db.prepare(`DELETE FROM books WHERE id = ?`).run(bookId) } catch { /* ignore */ }
        return reply.code(500).send({ error: err.message })
      }
    },
  )

  app.post<{ Body: { bookId: string } }>(
    '/api/agent-sessions/chapter-next',
    async (req, reply) => {
      const { bookId } = req.body
      if (activeBookIds.has(bookId)) {
        return reply.code(409).send({ error: `book ${bookId} already running` })
      }
      const book: any = deps.db.prepare(`SELECT id, title, root_path FROM books WHERE id = ?`).get(bookId)
      if (!book) return reply.code(404).send({ error: 'book not found' })
      if (String(book.root_path).startsWith('pending:')) {
        return reply.code(409).send({ error: 'book is still being created' })
      }

      const maxRow: any = deps.db.prepare(`SELECT MAX(chapter_number) AS maxNum FROM chapters WHERE book_id = ?`).get(bookId)
      const next = (maxRow?.maxNum ?? 0) + 1
      const nnn = String(next).padStart(3, '0')
      const sourcePath = join(book.root_path, '正文', `第${nnn}章.md`)

      // Guard against a leftover chapters row pointing at the same path (UNIQUE(source_path)).
      const dupe: any = deps.db.prepare(`SELECT id FROM chapters WHERE source_path = ?`).get(sourcePath)
      if (dupe) {
        return reply.code(409).send({ error: `chapter ${next} already exists` })
      }

      await mkdir(join(book.root_path, '正文'), { recursive: true })
      await writeFile(sourcePath, `# 第${next}章\n<!-- 正文待 agent 续写 -->\n`, 'utf8')

      const chapterId = randomUUID()
      deps.db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(chapterId, bookId, next, `第${next}章`, sourcePath, '待写作')

      const sessionId = randomUUID()
      const emitter = new EventEmitter()
      sessionEmitters.set(sessionId, emitter)
      sessionToBook.set(sessionId, bookId)
      activeBookIds.add(bookId)

      try {
        const runner = await deps.service.start({
          actionKey: 'chapter.next',
          bookMeta: { id: book.id, title: book.title, rootPath: book.root_path },
          chapter: { id: chapterId, chapterNumber: next, title: `第${next}章`, sourcePath, stage: '待写作' },
          sessionId, emitter,
          onSettled: () => activeBookIds.delete(bookId),
        })
        return { sessionId, chapterId, status: runner.status, traceId: runner.traceId }
      } catch (err: any) {
        sessionEmitters.delete(sessionId)
        sessionToBook.delete(sessionId)
        activeBookIds.delete(bookId)
        // Roll back the placeholder chapter row so a failed start leaves no ghost chapter.
        try { deps.db.prepare(`DELETE FROM chapters WHERE id = ?`).run(chapterId) } catch { /* ignore */ }
        if (/already running|concurrent limit/i.test(err.message)) {
          return reply.code(409).send({ error: err.message })
        }
        return reply.code(500).send({ error: err.message })
      }
    },
  )
}
