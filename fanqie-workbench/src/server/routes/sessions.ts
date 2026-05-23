import type { FastifyInstance } from 'fastify'
import { resolve } from 'node:path'
import { syncWorkspaceBooks } from '../../db/repositories/books-repo.js'
import { openDatabase } from '../../db/client.js'
import {
  appendSessionMessage,
  createSession,
  findBookMasterSession,
  getSessionById,
  getSessionMessages,
  listSessionsByKind,
  updateSessionMetadata,
  updateSessionPendingQuestion,
  updateSessionStatus,
  type SessionKind,
} from '../../db/repositories/sessions-repo.js'
import { runBookEntryTerminalSession } from '../../claude/book-entry-terminal-runner.js'
import { buildActionCommand } from '../../actions/action-command-builder.js'
import { normalizeActionKey } from '../../actions/action-registry.js'
import { ClaudeSession, type ClaudeEvent } from '../../claude/claude-executor.js'
import { getOrCreateEmitter } from '../../claude/stream-capture.js'
import { getSessionRuntimeOptions, clearSessionRuntimeOptions } from '../../claude/session-runtime-options.js'
import { runTerminalSessionCommand } from '../../claude/terminal-session-runner.js'
import { createTerminalRuntime, type PermissionChoice } from '../../claude/terminal-runtime.js'
import { runTerminalCaptureLoop } from '../../claude/terminal-capture-loop.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')

function buildBookEntryCommand(idea: string) {
  return `/story-long-write 帮我开书：${idea}，请在 novels/ 下创建标准长篇项目结构`
}

function appendAndEmitSessionMessage(
  db: ReturnType<typeof openDatabase>,
  sessionId: string,
  emitter: ReturnType<typeof getOrCreateEmitter>,
  input: { role: string; stream?: string | null; content: string },
) {
  const id = appendSessionMessage(db, sessionId, input)
  emitter.emit('log', { id, stream: input.stream ?? 'stdout', chunk: input.content })
}

function runPromptSession(sessionId: string, prompt: string, currentSkill: string | null | undefined) {
  const emitter = getOrCreateEmitter(sessionId)
  const runDb = openDatabase(getDatabasePath())
  const session = new ClaudeSession()
  let finished = false

  session.on('claude', (event: ClaudeEvent) => {
    switch (event.type) {
      case 'text': {
        appendAndEmitSessionMessage(runDb, sessionId, emitter, { role: 'assistant', stream: 'stdout', content: event.text })
        break
      }
      case 'tool_use': {
        appendAndEmitSessionMessage(runDb, sessionId, emitter, { role: 'tool', stream: 'stdout', content: `\n[tool: ${event.name}]\n` })
        break
      }
      case 'question': {
        if (finished) break
        finished = true
        const question = event.question || '请继续补充这本书的方向。'
        updateSessionStatus(runDb, sessionId, 'waiting-answer')
        updateSessionPendingQuestion(runDb, sessionId, { question, options: event.options })
        emitter.emit('question', { toolUseId: event.toolUseId, question, options: event.options })
        session.kill()
        runDb.close()
        break
      }
      case 'error': {
        appendAndEmitSessionMessage(runDb, sessionId, emitter, { role: 'assistant', stream: 'stderr', content: event.message })
        break
      }
      case 'done': {
        if (finished) return
        finished = true
        const status = event.exitCode === 0 ? 'succeeded' : 'failed'
        updateSessionStatus(runDb, sessionId, status, currentSkill ?? null)
        emitter.emit('done', { status })
        runDb.close()
        break
      }
    }
  })

  session.start(prompt)
}

export async function registerSessionRoutes(app: FastifyInstance) {
  app.post<{
    Body: { kind: SessionKind; bookId?: string; chapterId?: string; currentSkill?: string; prompt?: string; idea?: string }
  }>('/api/sessions', async (request, reply) => {
    const { kind, bookId, chapterId, currentSkill, prompt, idea } = request.body || {} as any

    if (!kind) {
      return reply.code(400).send({ error: 'kind is required' })
    }

    const sessionPrompt = (currentSkill ?? null) === 'book-entry' && typeof idea === 'string'
      ? buildBookEntryCommand(idea.trim())
      : prompt

    const db = openDatabase(getDatabasePath())
    const isBookMasterSession = kind === 'prompt' && !!bookId && currentSkill === 'book-master-session'
    const existingBookMasterSession = isBookMasterSession ? findBookMasterSession(db, bookId) : null
    const session = existingBookMasterSession ?? createSession(db, { kind, bookId, chapterId, currentSkill })
    db.close()

    if (kind === 'prompt' && sessionPrompt && !existingBookMasterSession) {
      if ((currentSkill ?? null) === 'book-entry') {
        void runBookEntryTerminalSession({
          databasePath: getDatabasePath(),
          sessionId: session.id,
          prompt: sessionPrompt,
        })
      } else {
        runPromptSession(session.id, sessionPrompt, currentSkill)
      }
    }

    if (kind === 'chapter' && chapterId) {
      const emitter = getOrCreateEmitter(session.id)
      const runDb = openDatabase(getDatabasePath())
      const chapter = runDb.prepare(
        `SELECT c.id, c.stage, c.title, c.source_path, c.chapter_number, c.book_id,
                b.title AS book_title, b.root_path AS book_root
         FROM chapters c
         JOIN books b ON b.id = c.book_id
         WHERE c.id = ?`
      ).get(chapterId) as {
        id: string
        stage: string
        title: string
        source_path: string
        chapter_number: number
        book_id: string
        book_title: string
        book_root: string
      } | undefined

      if (chapter) {
        const actionKey = normalizeActionKey(currentSkill || 'chapter-pipeline')
        const command = buildActionCommand({
          actionKey,
          bookTitle: chapter.book_title,
          bookRoot: chapter.book_root,
          chapterNumber: chapter.chapter_number,
          chapterTitle: chapter.title,
          chapterPath: chapter.source_path,
        })

        void runTerminalSessionCommand({
          databasePath: getDatabasePath(),
          sessionId: session.id,
          bookId: chapter.book_id,
          command,
          currentSkill: currentSkill ?? undefined,
        })
        runDb.close()
      } else {
        updateSessionStatus(runDb, session.id, 'failed', currentSkill ?? null)
        appendAndEmitSessionMessage(runDb, session.id, emitter, {
          role: 'assistant',
          stream: 'stderr',
          content: 'chapter not found',
        })
        emitter.emit('done', { status: 'failed' })
        runDb.close()
      }
    }

    return reply.code(201).send({ session })
  })

  app.get<{ Querystring: { kind?: SessionKind } }>('/api/sessions', async (request) => {
    const { kind } = request.query || {}
    const db = openDatabase(getDatabasePath())
    const sessions = kind ? listSessionsByKind(db, kind) : []
    db.close()
    return { sessions }
  })

  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params
    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)
    db.close()

    if (!session) {
      return reply.code(404).send({ error: 'session not found' })
    }

    return { session }
  })

  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/stream', async (request, reply) => {
    const { sessionId } = request.params
    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)

    if (!session) {
      db.close()
      return reply.code(404).send({ error: 'session not found' })
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    const messages = getSessionMessages(db, sessionId)
    for (const message of messages) {
      reply.raw.write(`data: ${JSON.stringify({ id: message.id, stream: message.stream || 'stdout', chunk: message.content })}\n\n`)
    }

    if (session.pendingQuestionJson) {
      reply.raw.write(`event: question\ndata: ${session.pendingQuestionJson}\n\n`)
    }

    if (session.contextSnapshotJson) {
      try {
        const snapshot = JSON.parse(session.contextSnapshotJson) as { permissionPrompt?: unknown }
        if (snapshot.permissionPrompt && session.status === 'waiting-permission') {
          reply.raw.write(`event: permission-blocked\ndata: ${JSON.stringify(snapshot.permissionPrompt)}\n\n`)
        }
      } catch {}
    }

    if (session.status === 'succeeded' || session.status === 'failed') {
      reply.raw.write(`event: done\ndata: ${JSON.stringify({ status: session.status })}\n\n`)
      reply.raw.end()
      db.close()
      return
    }

    db.close()
    const emitter = getOrCreateEmitter(sessionId)

    const onLog = (data: { stream: string; chunk: string }) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }
    const onQuestion = (data: { toolUseId: string; question: string; options: any[] }) => {
      reply.raw.write(`event: question\ndata: ${JSON.stringify(data)}\n\n`)
    }
    const onPermissionBlocked = (data: any) => {
      reply.raw.write(`event: permission-blocked\ndata: ${JSON.stringify(data)}\n\n`)
    }
    const onDone = (data: { status: string }) => {
      reply.raw.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`)
      reply.raw.end()
      cleanup()
    }
    const cleanup = () => {
      emitter.off('log', onLog)
      emitter.off('question', onQuestion)
      emitter.off('permission-blocked', onPermissionBlocked)
      emitter.off('done', onDone)
    }

    emitter.on('log', onLog)
    emitter.on('question', onQuestion)
    emitter.on('permission-blocked', onPermissionBlocked)
    emitter.on('done', onDone)
    request.raw.on('close', cleanup)
  })

  app.post<{
    Params: { sessionId: string }
    Body: { choice?: PermissionChoice }
  }>('/api/sessions/:sessionId/permission', async (request, reply) => {
    const { sessionId } = request.params
    const { choice } = request.body || {} as any
    if (choice !== 'allow-once' && choice !== 'deny') return reply.code(400).send({ error: 'choice must be allow-once or deny' })

    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)
    if (!session) {
      db.close()
      return reply.code(404).send({ error: 'session not found' })
    }
    const runtimeOptions = getSessionRuntimeOptions(sessionId)
    const runtimeBookId = runtimeOptions?.runtimeBookId ?? session.bookId
    if (!runtimeBookId) {
      db.close()
      return reply.code(400).send({ error: 'session has no terminal runtime' })
    }
    if (session.status !== 'waiting-permission') {
      db.close()
      return reply.code(409).send({ error: 'session is not waiting for permission' })
    }

    const runtime = createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
    await runtime.sendPermissionChoice({ bookId: runtimeBookId, choice })
    appendSessionMessage(db, sessionId, {
      role: 'user',
      stream: 'permission',
      content: choice === 'allow-once' ? 'allowed permission once' : 'denied permission',
    })

    if (choice === 'deny') {
      clearSessionRuntimeOptions(sessionId)
      updateSessionMetadata(db, sessionId, { contextSnapshotJson: null })
      updateSessionStatus(db, sessionId, 'failed', session.currentSkill)
      db.close()
      getOrCreateEmitter(sessionId).emit('done', { status: 'failed' })
      return { handled: true }
    }

    updateSessionMetadata(db, sessionId, { contextSnapshotJson: null })
    updateSessionStatus(db, sessionId, 'running', session.currentSkill)
    db.close()

    void (async () => {
      const captureDb = openDatabase(getDatabasePath())
      try {
        const completion = await runTerminalCaptureLoop({
          db: captureDb,
          sessionId,
          bookId: runtimeBookId,
          runtime,
          currentSkill: runtimeOptions?.currentSkill ?? session.currentSkill,
          isComplete: runtimeOptions?.isComplete ?? (runtimeOptions?.completeOnFirstCapture ? ((capture) => !!capture.trim()) : undefined),
          completeStatus: runtimeOptions?.completeStatus,
          beforeComplete: runtimeOptions?.beforeComplete
            ? (capture) => runtimeOptions.beforeComplete!({ db: captureDb, capture, sessionId, bookId: runtimeBookId })
            : undefined,
        })
        if (completion.status !== 'waiting-permission') clearSessionRuntimeOptions(sessionId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        appendSessionMessage(captureDb, sessionId, { role: 'assistant', stream: 'stderr', content: message })
        updateSessionStatus(captureDb, sessionId, 'failed', session.currentSkill)
        clearSessionRuntimeOptions(sessionId)
        getOrCreateEmitter(sessionId).emit('done', { status: 'failed' })
      } finally {
        captureDb.close()
      }
    })()

    return { handled: true }
  })

  app.post<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/interrupt', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, request.params.sessionId)

    if (!session) {
      db.close()
      return reply.code(404).send({ error: 'session not found' })
    }

    const runtimeBookId = getSessionRuntimeOptions(request.params.sessionId)?.runtimeBookId ?? session.bookId
    if (runtimeBookId) {
      const runtime = createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
      await runtime.interrupt({ bookId: runtimeBookId }).catch(() => {})
    }

    clearSessionRuntimeOptions(request.params.sessionId)
    updateSessionStatus(db, request.params.sessionId, 'failed', session.currentSkill)
    appendSessionMessage(db, request.params.sessionId, { role: 'assistant', stream: 'stderr', content: 'session interrupted by user' })
    db.close()
    getOrCreateEmitter(request.params.sessionId).emit('done', { status: 'failed' })
    return { interrupted: true }
  })

  app.post<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/complete', async (request, reply) => {
    const { sessionId } = request.params
    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)
    if (!session) {
      db.close()
      return reply.code(404).send({ error: 'session not found' })
    }
    if (session.status === 'succeeded' || session.status === 'failed') {
      db.close()
      return reply.code(409).send({ error: 'session already finished' })
    }

    clearSessionRuntimeOptions(sessionId)
    updateSessionStatus(db, sessionId, 'succeeded', session.currentSkill)
    appendSessionMessage(db, sessionId, { role: 'assistant', stream: 'stdout', content: '\n[用户标记完成]' })
    db.close()
    getOrCreateEmitter(sessionId).emit('done', { status: 'succeeded' })

    const scanResult = await syncWorkspaceBooks({ novelsRoot: resolve(WORKSPACE_ROOT, 'novels'), databasePath: getDatabasePath() })
    return { completed: true, scan: scanResult }
  })

  app.post<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/compress', async (request, reply) => {
    const { sessionId } = request.params
    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)
    if (!session) {
      db.close()
      return reply.code(404).send({ error: 'session not found' })
    }

    updateSessionMetadata(db, sessionId, {
      compressedAt: new Date().toISOString(),
    })
    const updated = getSessionById(db, sessionId)
    db.close()
    return { session: updated }
  })

  app.post<{
    Params: { sessionId: string }
    Body: { answer: string }
  }>('/api/sessions/:sessionId/answer', async (request, reply) => {
    const { sessionId } = request.params
    const { answer } = request.body || {} as any

    if (!answer) {
      return reply.code(400).send({ error: 'answer is required' })
    }

    const db = openDatabase(getDatabasePath())
    const session = getSessionById(db, sessionId)
    if (!session) {
      db.close()
      return reply.code(404).send({ error: 'session not found' })
    }
    if (session.status !== 'waiting-answer') {
      db.close()
      return reply.code(409).send({ error: 'session is not waiting for an answer' })
    }

    const runtimeBookId = getSessionRuntimeOptions(sessionId)?.runtimeBookId ?? session.bookId
    if (!runtimeBookId) {
      db.close()
      return reply.code(400).send({ error: 'session has no terminal runtime' })
    }

    const runtime = createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })

    const optionMatch = answer.match(/^(\d+)\./)
    if (optionMatch) {
      const optionNumber = parseInt(optionMatch[1])
      const keys: string[] = []
      for (let i = 1; i < optionNumber; i++) keys.push('Down')
      keys.push('Enter')
      await runtime.sendKeys({ bookId: runtimeBookId, keys })
    } else {
      await runtime.sendText({ bookId: runtimeBookId, text: answer })
    }

    appendSessionMessage(db, sessionId, { role: 'user', stream: 'question', content: answer })
    updateSessionPendingQuestion(db, sessionId, null)
    updateSessionStatus(db, sessionId, 'running', session.currentSkill)
    db.close()

    void (async () => {
      const captureDb = openDatabase(getDatabasePath())
      try {
        const baseline = await runtime.capture({ bookId: runtimeBookId })
        await runTerminalCaptureLoop({
          db: captureDb,
          sessionId,
          bookId: runtimeBookId,
          runtime,
          currentSkill: session.currentSkill,
          initialCapture: baseline,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        appendSessionMessage(captureDb, sessionId, { role: 'assistant', stream: 'stderr', content: message })
        updateSessionStatus(captureDb, sessionId, 'failed', session.currentSkill)
        getOrCreateEmitter(sessionId).emit('done', { status: 'failed' })
      } finally {
        captureDb.close()
      }
    })()

    return { answered: true }
  })
}
