import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../../db/client.js'
import { getSessionById, getSessionMessages, updateSessionStatus } from '../../db/repositories/sessions-repo.js'
import { getBookEntryPtyManager } from '../../claude/book-entry-terminal-runner.js'
import type { PtyManager } from '../../claude/pty-manager.js'
import type { ParsedEvent } from '../../claude/pty-event-parser.js'

export function getSharedPtyManager(): PtyManager {
  return getBookEntryPtyManager()
}

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

export async function registerPtyWsRoutes(app: FastifyInstance) {
  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/terminal',
    { websocket: true },
    (socket, request) => {
      const { sessionId } = request.params as { sessionId: string }
      const db = openDatabase(getDatabasePath())
      const session = getSessionById(db, sessionId)

      if (!session) {
        db.close()
        socket.close(4004, 'session not found')
        return
      }

      const bookId = session.bookId ?? 'book-entry'
      const manager = getBookEntryPtyManager()
      const ptySession = manager.getSession(bookId)

      if (!ptySession) {
        db.close()
        socket.close(4004, 'no PTY session')
        return
      }

      // Send history
      const messages = getSessionMessages(db, sessionId)
      socket.send(JSON.stringify({ type: 'history', messages }))

      // Send buffered PTY output for reconnection
      const buffer = ptySession.parser.getBuffer()
      if (buffer) {
        socket.send(JSON.stringify({ type: 'output', data: buffer }))
      }

      // Forward PTY output
      const onOutput = (data: string) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'output', data }))
        }
      }

      const onQuestion = (event: ParsedEvent) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(event))
          updateSessionStatus(db, sessionId, 'waiting-answer', session.currentSkill)
        }
      }

      const onThinking = (event: ParsedEvent) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(event))
        }
      }

      const onIdle = () => {
        if (socket.readyState === 1) {
          updateSessionStatus(db, sessionId, 'succeeded', session.currentSkill)
          socket.send(JSON.stringify({ type: 'done', status: 'succeeded' }))
        }
      }

      const onPermission = (event: ParsedEvent) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(event))
          updateSessionStatus(db, sessionId, 'waiting-permission', session.currentSkill)
        }
      }

      const onExit = (code: number) => {
        const status = code === 0 ? 'succeeded' : 'failed'
        updateSessionStatus(db, sessionId, status, session.currentSkill)
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'done', status }))
          socket.close(1000)
        }
        cleanup()
      }

      ptySession.emitter.on('output', onOutput)
      ptySession.emitter.on('question', onQuestion)
      ptySession.emitter.on('thinking', onThinking)
      ptySession.emitter.on('idle', onIdle)
      ptySession.emitter.on('permission', onPermission)
      ptySession.emitter.on('exit', onExit)

      socket.on('message', (raw: unknown) => {
        const msg = JSON.parse(String(raw)) as { type: string; data?: string; cols?: number; rows?: number; answer?: string }
        switch (msg.type) {
          case 'input':
            if (msg.data) manager.write(bookId, msg.data)
            break
          case 'resize':
            if (msg.cols && msg.rows) manager.resize(bookId, msg.cols, msg.rows)
            break
          case 'answer': {
            if (!msg.answer) break
            const optionMatch = msg.answer.match(/^(\d+)\./)
            if (optionMatch) {
              const n = parseInt(optionMatch[1])
              const keys: string[] = []
              for (let i = 1; i < n; i++) keys.push('Down')
              keys.push('Enter')
              manager.sendKeys(bookId, keys)
            } else {
              manager.write(bookId, msg.answer + '\r')
            }
            updateSessionStatus(db, sessionId, 'running', session.currentSkill)
            break
          }
        }
      })

      const cleanup = () => {
        ptySession.emitter.off('output', onOutput)
        ptySession.emitter.off('question', onQuestion)
        ptySession.emitter.off('thinking', onThinking)
        ptySession.emitter.off('idle', onIdle)
        ptySession.emitter.off('permission', onPermission)
        ptySession.emitter.off('exit', onExit)
        db.close()
      }

      socket.on('close', cleanup)
      socket.on('error', cleanup)
    },
  )
}
