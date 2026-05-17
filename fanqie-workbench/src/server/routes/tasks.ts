import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../../db/client.js'
import { executeClaudePrompt } from '../../claude/claude-executor.js'
import { getOrCreateEmitter, removeEmitter, writeLogChunk } from '../../claude/stream-capture.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

// Legacy prompt task endpoint. Book/chapter writing uses /api/sessions and ClaudeTerminalRuntime.
export async function registerTaskRoutes(app: FastifyInstance) {
  app.post<{ Body: { type?: string; prompt: string; bookId?: string; chapterId?: string } }>('/api/tasks', async (request, reply) => {
    const { type = 'custom-prompt', prompt, bookId, chapterId } = request.body || {} as any

    if (!prompt) {
      return reply.code(400).send({ error: 'prompt is required' })
    }

    const taskId = randomUUID()
    const db = openDatabase(getDatabasePath())
    const now = new Date().toISOString()

    db.prepare('INSERT INTO tasks (id, type, prompt, book_id, chapter_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      taskId, type, prompt, bookId || null, chapterId || null, 'running', now
    )

    const emitter = getOrCreateEmitter(taskId)

    // Fire and forget — execution runs in background
    executeClaudePrompt(prompt, {
      onStdout: (chunk) => {
        writeLogChunk(db, taskId, 'stdout', chunk)
        emitter.emit('log', { stream: 'stdout', chunk })
      },
      onStderr: (chunk) => {
        writeLogChunk(db, taskId, 'stderr', chunk)
        emitter.emit('log', { stream: 'stderr', chunk })
      },
    }).then((result) => {
      const status = result.exitCode === 0 ? 'succeeded' : 'failed'
      db.prepare('UPDATE tasks SET status = ?, exit_code = ?, finished_at = ? WHERE id = ?').run(
        status, result.exitCode, new Date().toISOString(), taskId
      )
      emitter.emit('done', { status, exitCode: result.exitCode })
      removeEmitter(taskId)
      db.close()
    }).catch((err) => {
      db.prepare('UPDATE tasks SET status = ?, finished_at = ? WHERE id = ?').run(
        'failed', new Date().toISOString(), taskId
      )
      emitter.emit('done', { status: 'failed', error: String(err) })
      removeEmitter(taskId)
      db.close()
    })

    return reply.code(202).send({ taskId, status: 'running' })
  })

  app.get('/api/tasks', async () => {
    const db = openDatabase(getDatabasePath())
    const tasks = db.prepare('SELECT id, type, prompt, status, created_at, finished_at FROM tasks ORDER BY created_at DESC LIMIT 50').all()
    db.close()
    return { tasks }
  })

  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId', async (request) => {
    const { taskId } = request.params
    const db = openDatabase(getDatabasePath())
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
    db.close()
    return { task: task || null }
  })

  app.delete('/api/tasks', async (_request, reply) => {
    const db = openDatabase(getDatabasePath())
    db.prepare('DELETE FROM task_logs').run()
    db.prepare('DELETE FROM tasks').run()
    db.close()
    return reply.code(204).send()
  })
}
