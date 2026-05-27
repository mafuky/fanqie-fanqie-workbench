import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import Database from 'better-sqlite3'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'
import { registerAgentWsRoute } from '../../src/server/routes/agent-ws.js'

describe('agent WebSocket route', () => {
  it('upgrades, replays history events, then forwards new events', async () => {
    const db = new Database(':memory:'); db.exec(schemaSql)
    const traceStore = createTraceStore(db)
    const traceId = traceStore.createTrace({ bookId: 'b1', chapterId: 'c1', actionKey: 'chapter.continue', sessionId: 'sess-1', model: 'gpt-5' })
    traceStore.appendEvent(traceId, { phase: 'load-context', eventType: 'phase-start', payload: { type: 'phase-start', phase: 'load-context' } })

    const emitter = new EventEmitter()
    const app = Fastify()
    await app.register(websocket)
    registerAgentWsRoute(app, {
      getSessionEmitter: () => emitter,
      getSessionTraceId: () => traceId,
      traceStore,
    })
    await app.listen({ port: 0 })
    const port = (app.server.address() as any).port

    const WebSocket = (await import('ws')).default
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/agent-sessions/sess-1/stream`)
    const got: any[] = []
    ws.on('message', (msg) => got.push(JSON.parse(msg.toString())))
    await new Promise((r) => ws.on('open', r))
    await new Promise((r) => setTimeout(r, 30))
    expect(got.some((m) => m.type === 'history')).toBe(true)

    emitter.emit('event', { type: 'message', phase: 'load-context', role: 'assistant', content: 'hi' })
    await new Promise((r) => setTimeout(r, 30))
    expect(got.some((m) => m.type === 'message' && m.content === 'hi')).toBe(true)

    ws.close()
    await app.close()
  })
})
