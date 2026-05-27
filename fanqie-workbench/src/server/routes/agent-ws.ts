import type { FastifyInstance } from 'fastify'
import type { EventEmitter } from 'node:events'
import type { TraceStore } from '../../agentic/trace-store.js'

export interface AgentWsDeps {
  getSessionEmitter(sessionId: string): EventEmitter | undefined
  getSessionTraceId(sessionId: string): number | undefined
  traceStore: TraceStore
}

export function registerAgentWsRoute(app: FastifyInstance, deps: AgentWsDeps) {
  app.get<{ Params: { sessionId: string } }>(
    '/api/agent-sessions/:sessionId/stream',
    { websocket: true },
    (socket, req) => {
      const { sessionId } = req.params as { sessionId: string }
      const emitter = deps.getSessionEmitter(sessionId)
      const traceId = deps.getSessionTraceId(sessionId)
      if (!emitter || traceId === undefined) {
        socket.send(JSON.stringify({ type: 'error', message: 'session not found' }))
        socket.close()
        return
      }
      const history = deps.traceStore.listEvents(traceId).map((e) => e.payload)
      socket.send(JSON.stringify({ type: 'history', events: history }))
      const handler = (ev: any) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(ev))
      }
      emitter.on('event', handler)
      socket.on('close', () => emitter.off('event', handler))
    },
  )
}
