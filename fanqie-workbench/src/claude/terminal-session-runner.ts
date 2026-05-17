import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { openDatabase } from '../db/client.js'
import {
  appendSessionMessage,
  updateSessionMetadata,
  updateSessionStatus,
} from '../db/repositories/sessions-repo.js'
import { defaultRuntimeScheduler } from './runtime-scheduler.js'
import { getOrCreateEmitter } from './stream-capture.js'
import { createTerminalRuntime, type TerminalRuntime } from './terminal-runtime.js'

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function runTerminalSessionCommand(input: {
  databasePath: string
  sessionId: string
  bookId: string
  command: string
  runtime?: TerminalRuntime
  captureDelayMs?: number
}) {
  await defaultRuntimeScheduler.run({ bookId: input.bookId }, async () => {
    const runtime = input.runtime ?? createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
    const emitter = getOrCreateEmitter(input.sessionId)
    let db: Database.Database | null = null

    try {
      db = openDatabase(input.databasePath)
      updateSessionStatus(db, input.sessionId, 'running')

      const ensured = await runtime.ensureSession({ bookId: input.bookId })
      updateSessionMetadata(db, input.sessionId, {
        contextSnapshotJson: JSON.stringify({ tmuxSessionName: ensured.sessionName }),
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

      await runtime.sendText({ bookId: input.bookId, text: input.command })
      await wait(input.captureDelayMs ?? 1000)

      const output = await runtime.capture({ bookId: input.bookId })
      if (output.trim()) {
        const outputMessageId = appendSessionMessage(db, input.sessionId, {
          role: 'assistant',
          stream: 'stdout',
          content: output,
        })
        emitter.emit('log', {
          id: outputMessageId,
          stream: 'stdout',
          chunk: output,
        })
      }

      updateSessionStatus(db, input.sessionId, 'succeeded')
      emitter.emit('done', { status: 'succeeded' })
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
          updateSessionStatus(db, input.sessionId, 'failed')
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
  })
}
