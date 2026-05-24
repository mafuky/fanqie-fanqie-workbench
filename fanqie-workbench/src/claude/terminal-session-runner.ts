import { resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from '../db/client.js'
import {
  appendSessionMessage,
  updateSessionMetadata,
  updateSessionStatus,
  type SessionStatus,
} from '../db/repositories/sessions-repo.js'
import { defaultRuntimeScheduler } from './runtime-scheduler.js'
import { clearSessionRuntimeOptions, storeSessionRuntimeOptions } from './session-runtime-options.js'
import { getOrCreateEmitter } from './stream-capture.js'
import { runTerminalCaptureLoop } from './terminal-capture-loop.js'
import { createTerminalRuntime, type TerminalRuntime } from './terminal-runtime.js'

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..')

export type TerminalSessionCompletionInput = {
  completeOnFirstCapture?: boolean
  completeStatus?: Extract<SessionStatus, 'succeeded' | 'waiting-review'>
  beforeComplete?: (input: { db: Database.Database; capture: string; sessionId: string; bookId: string }) => Promise<void>
}

export type RunTerminalSessionCommandInput = TerminalSessionCompletionInput & {
  databasePath: string
  sessionId: string
  bookId: string
  command: string
  runtime?: TerminalRuntime
  captureDelayMs?: number
  captureIntervalMs?: number
  maxCaptureMs?: number
  isComplete?: (capture: string) => boolean
  currentSkill?: string | null
}

function createBeforeComplete(input: RunTerminalSessionCommandInput, db: Database.Database) {
  return input.beforeComplete
    ? (capture: string) => input.beforeComplete!({ db, capture, sessionId: input.sessionId, bookId: input.bookId })
    : undefined
}

export async function runTerminalSessionCommand(input: RunTerminalSessionCommandInput) {
  await defaultRuntimeScheduler.run({ bookId: input.bookId }, async () => {
    const runtime = input.runtime ?? createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
    const emitter = getOrCreateEmitter(input.sessionId)
    let db: Database.Database | null = null

    try {
      db = openDatabase(input.databasePath)
      updateSessionStatus(db, input.sessionId, 'running', input.currentSkill ?? undefined)

      const ensured = await runtime.ensureSession({ bookId: input.bookId })
      updateSessionMetadata(db, input.sessionId, {
        contextSnapshotJson: JSON.stringify({ tmuxSessionName: ensured.sessionName }),
      })

      storeSessionRuntimeOptions(input.sessionId, {
        runtimeBookId: input.bookId,
        currentSkill: input.currentSkill,
        isComplete: input.isComplete,
        completeOnFirstCapture: input.completeOnFirstCapture,
        completeStatus: input.completeStatus,
        beforeComplete: input.beforeComplete,
      })

      const inputContent = `${input.command}\n`
      const inputMessageId = appendSessionMessage(db, input.sessionId, {
        role: 'user',
        stream: 'input',
        content: inputContent,
      })
      emitter.emit('log', {
        id: inputMessageId,
        stream: 'input',
        chunk: inputContent,
      })

      const baseline = await runtime.capture({ bookId: input.bookId })
      await runtime.sendText({ bookId: input.bookId, text: input.command })
      const completion = await runTerminalCaptureLoop({
        db,
        sessionId: input.sessionId,
        bookId: input.bookId,
        runtime,
        currentSkill: input.currentSkill,
        captureIntervalMs: input.captureIntervalMs ?? input.captureDelayMs,
        maxCaptureMs: input.maxCaptureMs,
        initialCapture: baseline,
        isComplete: input.isComplete ?? (input.completeOnFirstCapture ? ((capture) => !!capture.trim()) : undefined),
        completeStatus: input.completeStatus,
        beforeComplete: createBeforeComplete(input, db),
      })
      if (completion.status === 'succeeded' || completion.status === 'failed') clearSessionRuntimeOptions(input.sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (db) {
        try {
          const errorMessageId = appendSessionMessage(db, input.sessionId, {
            role: 'assistant',
            stream: 'stderr',
            content: message,
          })
          emitter.emit('log', {
            id: errorMessageId,
            stream: 'stderr',
            chunk: message,
          })
        } catch {}

        try {
          updateSessionStatus(db, input.sessionId, 'failed', input.currentSkill ?? undefined)
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
  })
}
