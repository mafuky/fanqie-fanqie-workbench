import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import { PtyEventParser } from './pty-event-parser.js'

export interface PtySession {
  id: string
  pty: pty.IPty
  emitter: EventEmitter
  parser: PtyEventParser
  status: 'starting' | 'ready' | 'running' | 'idle'
}

export interface PtyManager {
  spawn(bookId: string): Promise<PtySession>
  kill(bookId: string): void
  getSession(bookId: string): PtySession | null
  write(bookId: string, data: string): void
  sendKeys(bookId: string, keys: string[]): void
  resize(bookId: string, cols: number, rows: number): void
}

const KEY_MAP: Record<string, string> = {
  Enter: '\r',
  Space: ' ',
  Up: '\x1b[A',
  Down: '\x1b[B',
  Left: '\x1b[D',
  Right: '\x1b[C',
  Escape: '\x1b',
  Tab: '\t',
}

export function createPtyManager(input: { projectRoot: string }): PtyManager {
  const sessions = new Map<string, PtySession>()

  return {
    async spawn(bookId) {
      const existing = sessions.get(bookId)
      if (existing) {
        existing.pty.kill()
        sessions.delete(bookId)
      }

      const emitter = new EventEmitter()
      const parser = new PtyEventParser()

      const child = pty.spawn('claude', ['--permission-mode', 'bypassPermissions'], {
        name: 'xterm-256color',
        cwd: input.projectRoot,
        cols: 120,
        rows: 40,
        env: { ...process.env, TERM: 'xterm-256color' },
      })

      const session: PtySession = { id: bookId, pty: child, emitter, parser, status: 'starting' }
      sessions.set(bookId, session)

      child.onData((data) => {
        emitter.emit('output', data)
        const events = parser.feed(data)
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })

      child.onExit(({ exitCode }) => {
        emitter.emit('exit', exitCode)
        sessions.delete(bookId)
      })

      return session
    },

    kill(bookId) {
      const session = sessions.get(bookId)
      if (!session) return
      session.pty.kill()
      sessions.delete(bookId)
    },

    getSession(bookId) {
      return sessions.get(bookId) ?? null
    },

    write(bookId, data) {
      const session = sessions.get(bookId)
      if (!session) throw new Error(`no PTY session for bookId=${bookId}`)
      session.pty.write(data)
    },

    sendKeys(bookId, keys) {
      const session = sessions.get(bookId)
      if (!session) throw new Error(`no PTY session for bookId=${bookId}`)
      for (const key of keys) {
        session.pty.write(KEY_MAP[key] ?? key)
      }
    },

    resize(bookId, cols, rows) {
      const session = sessions.get(bookId)
      if (!session) return
      session.pty.resize(cols, rows)
    },
  }
}
