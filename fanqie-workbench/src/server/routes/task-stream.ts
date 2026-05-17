import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../../db/client.js'
import { getOrCreateEmitter, getTaskLogs } from '../../claude/stream-capture.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

export async function registerTaskStreamRoutes(app: FastifyInstance) {
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/stream', async (request, reply) => {
    const { taskId } = request.params

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    const db = openDatabase(getDatabasePath())
    const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string } | undefined

    // Replay existing logs
    const existingLogs = getTaskLogs(db, taskId)
    for (const log of existingLogs) {
      reply.raw.write(`data: ${JSON.stringify({ stream: log.stream, chunk: log.chunk })}\n\n`)
    }

    if (task && (task.status === 'succeeded' || task.status === 'failed')) {
      reply.raw.write(`event: done\ndata: ${JSON.stringify({ status: task.status })}\n\n`)
      reply.raw.end()
      db.close()
      return
    }

    db.close()

    const emitter = getOrCreateEmitter(taskId)

    const onLog = (data: { stream: string; chunk: string }) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    const onQuestion = (data: { toolUseId: string; question: string; options: any[] }) => {
      reply.raw.write(`event: question\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const onDone = (data: { status: string }) => {
      reply.raw.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`)
      reply.raw.end()
      cleanup()
    }

    const cleanup = () => {
      emitter.off('log', onLog)
      emitter.off('question', onQuestion)
      emitter.off('done', onDone)
    }

    emitter.on('log', onLog)
    emitter.on('question', onQuestion)
    emitter.on('done', onDone)

    request.raw.on('close', cleanup)
  })
}
