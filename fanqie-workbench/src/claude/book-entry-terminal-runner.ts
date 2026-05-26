import { resolve } from 'node:path'
import { openDatabase } from '../db/client.js'
import {
  appendSessionMessage,
  updateSessionStatus,
} from '../db/repositories/sessions-repo.js'
import { getOrCreateEmitter } from './stream-capture.js'
import { createPtyManager, type PtyManager } from './pty-manager.js'

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const BOOK_ENTRY_RUNTIME_BOOK_ID = 'book-entry'

let sharedManager: PtyManager | null = null

export function getBookEntryPtyManager(): PtyManager {
  if (!sharedManager) {
    sharedManager = createPtyManager({ projectRoot: WORKSPACE_ROOT })
  }
  return sharedManager
}

export type RunBookEntryTerminalSessionInput = {
  databasePath: string
  sessionId: string
  prompt?: string
  command?: string
}

export async function runBookEntryTerminalSession(input: RunBookEntryTerminalSessionInput): Promise<void> {
  const manager = getBookEntryPtyManager()
  const emitter = getOrCreateEmitter(input.sessionId)
  const command = input.command ?? input.prompt ?? ''
  let db: ReturnType<typeof openDatabase> | null = null

  try {
    db = openDatabase(input.databasePath)
    updateSessionStatus(db, input.sessionId, 'running', 'book-entry')

    const session = await manager.spawn(BOOK_ENTRY_RUNTIME_BOOK_ID)

    const inputContent = `${command}\n`
    const inputMessageId = appendSessionMessage(db, input.sessionId, {
      role: 'user',
      stream: 'input',
      content: inputContent,
    })
    emitter.emit('log', { id: inputMessageId, stream: 'input', chunk: inputContent })

    // Wait for Claude to be ready (prompt or bypass message), timeout 30s
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        resolve() // Proceed anyway on timeout
      }, 30_000)

      const onOutput = (data: string) => {
        if (data.includes('❯') || data.includes('bypass permissions on')) {
          cleanup()
          resolve()
        }
      }

      // Auto-handle "I accept" acceptance prompt
      const onQuestion = () => {
        manager.sendKeys(BOOK_ENTRY_RUNTIME_BOOK_ID, ['Down', 'Enter'])
      }

      const cleanup = () => {
        clearTimeout(timeout)
        session.emitter.off('output', onOutput)
        session.emitter.off('question', onQuestion)
      }

      session.emitter.on('output', onOutput)
      session.emitter.on('question', onQuestion)
    })

    // Send the command to the PTY
    manager.write(BOOK_ENTRY_RUNTIME_BOOK_ID, command + '\r')

    // NO capture loop — the WebSocket route (pty-ws) handles streaming to the frontend.
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
