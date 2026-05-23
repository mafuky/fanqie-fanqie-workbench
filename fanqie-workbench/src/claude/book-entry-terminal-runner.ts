import { resolve } from 'node:path'
import { appendFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { openDatabase } from '../db/client.js'
import {
  appendSessionMessage,
  updateSessionMetadata,
  updateSessionPendingQuestion,
  updateSessionStatus,
} from '../db/repositories/sessions-repo.js'
import { storeSessionRuntimeOptions, clearSessionRuntimeOptions } from './session-runtime-options.js'
import { getOrCreateEmitter } from './stream-capture.js'
import { runTerminalCaptureLoop } from './terminal-capture-loop.js'
import { createTerminalRuntime, type TerminalRuntime } from './terminal-runtime.js'

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const BOOK_ENTRY_RUNTIME_BOOK_ID = 'book-entry'

export type RunBookEntryTerminalSessionInput = {
  databasePath: string
  sessionId: string
  prompt?: string
  command?: string
  runtime?: TerminalRuntime
  captureIntervalMs?: number
  maxCaptureMs?: number
  isComplete?: (capture: string) => boolean
}

function debugLog(msg: string) {
  const p = resolve(import.meta.dirname, '..', '..', 'data', 'book-entry-debug.log')
  try { appendFileSync(p, `${new Date().toISOString()} ${msg}\n`) } catch (e) { console.error('debugLog failed', e) }
}

export async function runBookEntryTerminalSession(input: RunBookEntryTerminalSessionInput): Promise<void> {
  debugLog(`[called] sessionId=${input.sessionId} prompt=${input.prompt?.slice(0, 40)}`)
  const runtime = input.runtime ?? createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
  const emitter = getOrCreateEmitter(input.sessionId)
  const command = input.command ?? input.prompt ?? ''
  let db: Database.Database | null = null

  try {
    db = openDatabase(input.databasePath)
    updateSessionStatus(db, input.sessionId, 'running', 'book-entry')

    debugLog('[step] stopping old session...')
    await runtime.stop({ bookId: BOOK_ENTRY_RUNTIME_BOOK_ID }).catch((e) => debugLog(`[stop-err] ${e}`))
    debugLog('[step] ensuring new session...')
    const ensured = await runtime.ensureSession({ bookId: BOOK_ENTRY_RUNTIME_BOOK_ID })
    debugLog(`[step] session ready: ${ensured.sessionName} created=${ensured.created}`)
    updateSessionMetadata(db, input.sessionId, {
      contextSnapshotJson: JSON.stringify({ tmuxSessionName: ensured.sessionName }),
    })

    storeSessionRuntimeOptions(input.sessionId, {
      runtimeBookId: BOOK_ENTRY_RUNTIME_BOOK_ID,
      currentSkill: 'book-entry',
      isComplete: input.isComplete,
    })

    const inputContent = `${command}\n`
    const inputMessageId = appendSessionMessage(db, input.sessionId, {
      role: 'user',
      stream: 'input',
      content: inputContent,
    })
    emitter.emit('log', { id: inputMessageId, stream: 'input', chunk: inputContent })

    const baseline = await runtime.capture({ bookId: BOOK_ENTRY_RUNTIME_BOOK_ID })
    debugLog(`[step] baseline captured: ${baseline.length} chars, ${baseline.split('\\n').length} lines`)
    await runtime.sendText({ bookId: BOOK_ENTRY_RUNTIME_BOOK_ID, text: command })
    debugLog(`[step] command sent, starting capture loop`)

    const completion = await runTerminalCaptureLoop({
      db,
      sessionId: input.sessionId,
      bookId: BOOK_ENTRY_RUNTIME_BOOK_ID,
      runtime,
      currentSkill: 'book-entry',
      captureIntervalMs: input.captureIntervalMs,
      maxCaptureMs: input.maxCaptureMs,
      initialCapture: baseline,
      isComplete: input.isComplete,
    })
    if (completion.status !== 'waiting-permission') clearSessionRuntimeOptions(input.sessionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    debugLog(`[ERROR] ${message}`)
    if (error instanceof Error && error.stack) debugLog(`[STACK] ${error.stack}`)

    if (db) {
      try {
        const errorMessageId = appendSessionMessage(db, input.sessionId, {
          role: 'assistant',
          stream: 'stderr',
          content: message,
        })
        emitter.emit('log', { id: errorMessageId, stream: 'stderr', chunk: message })
      } catch {}

      try {
        updateSessionPendingQuestion(db, input.sessionId, null)
      } catch {}

      try {
        updateSessionStatus(db, input.sessionId, 'failed', 'book-entry')
      } catch {}
    }

    clearSessionRuntimeOptions(input.sessionId)
    emitter.emit('done', { status: 'failed' })
  } finally {
    if (db) {
      try {
        db.close()
      } catch {}
    }
  }
}
