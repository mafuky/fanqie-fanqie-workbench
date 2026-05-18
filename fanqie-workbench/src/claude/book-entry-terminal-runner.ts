import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { openDatabase } from '../db/client.js'
import {
  appendSessionMessage,
  updateSessionMetadata,
  updateSessionPendingQuestion,
  updateSessionStatus,
} from '../db/repositories/sessions-repo.js'
import { getOrCreateEmitter } from './stream-capture.js'
import { createTerminalRuntime, type TerminalRuntime } from './terminal-runtime.js'

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const BOOK_ENTRY_RUNTIME_BOOK_ID = 'book-entry'

export type RunBookEntryTerminalSessionInput = {
  databasePath: string
  sessionId: string
  command: string
  runtime?: TerminalRuntime
  captureIntervalMs?: number
  maxCaptureMs?: number
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getDelta(previous: string, next: string) {
  if (!next) return ''
  if (!previous) return next
  if (next.startsWith(previous)) return next.slice(previous.length)

  const previousLines = previous.split('\n')
  const nextLines = next.split('\n')
  const maxOverlap = Math.min(previousLines.length, nextLines.length)

  for (let size = maxOverlap; size > 0; size -= 1) {
    const previousTail = previousLines.slice(previousLines.length - size).join('\n')
    const nextHead = nextLines.slice(0, size).join('\n')
    if (previousTail === nextHead) {
      return nextLines.slice(size).join('\n')
    }
  }

  return ''
}

function getPendingQuestion(capture: string) {
  const lines = capture.split('\n').map((line) => line.trim()).filter(Boolean)
  const tail = lines.slice(-8).join('\n')
  return tail || '请继续补充这本书的方向。'
}

export async function runBookEntryTerminalSession(input: RunBookEntryTerminalSessionInput): Promise<void> {
  const runtime = input.runtime ?? createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
  const emitter = getOrCreateEmitter(input.sessionId)
  let db: Database.Database | null = null

  try {
    db = openDatabase(input.databasePath)
    updateSessionStatus(db, input.sessionId, 'running', 'book-entry')

    const ensured = await runtime.ensureSession({ bookId: BOOK_ENTRY_RUNTIME_BOOK_ID })
    updateSessionMetadata(db, input.sessionId, {
      contextSnapshotJson: JSON.stringify({ tmuxSessionName: ensured.sessionName }),
    })

    const inputContent = `${input.command}\n`
    const inputMessageId = appendSessionMessage(db, input.sessionId, {
      role: 'user',
      stream: 'input',
      content: inputContent,
    })
    emitter.emit('log', { id: inputMessageId, stream: 'input', chunk: inputContent })

    await runtime.sendText({ bookId: BOOK_ENTRY_RUNTIME_BOOK_ID, text: input.command })

    const intervalMs = input.captureIntervalMs ?? 1000
    const maxMs = input.maxCaptureMs ?? 180000
    const startedAt = Date.now()
    let previousCapture = ''
    let latestCapture = ''

    while (Date.now() - startedAt < maxMs) {
      await wait(intervalMs)
      latestCapture = await runtime.capture({ bookId: BOOK_ENTRY_RUNTIME_BOOK_ID })
      const delta = getDelta(previousCapture, latestCapture)
      previousCapture = latestCapture

      if (delta.trim()) {
        const outputMessageId = appendSessionMessage(db, input.sessionId, {
          role: 'assistant',
          stream: 'stdout',
          content: delta,
        })
        emitter.emit('log', { id: outputMessageId, stream: 'stdout', chunk: delta })
      }

    }

    const question = getPendingQuestion(latestCapture)
    updateSessionPendingQuestion(db, input.sessionId, { question, options: [] })
    updateSessionStatus(db, input.sessionId, 'waiting-answer', 'book-entry')
    emitter.emit('question', { toolUseId: 'book-entry', question, options: [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

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

    emitter.emit('done', { status: 'failed' })
  } finally {
    if (db) {
      try {
        db.close()
      } catch {}
    }
  }
}
