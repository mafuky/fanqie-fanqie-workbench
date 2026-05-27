import { useEffect, useRef, useState } from 'react'

type Event =
  | { type: 'history'; events: Event[] }
  | { type: 'phase-start'; phase: string }
  | { type: 'phase-done'; phase: string }
  | { type: 'message'; phase: string; role: string; content: string }
  | { type: 'tool-call'; phase: string; toolCallId: string; name: string; args: any }
  | { type: 'tool-result'; phase: string; toolCallId: string; name: string; result: string; ok: boolean }
  | { type: 'question'; question: string; options: { label: string }[]; multiSelect: boolean }
  | { type: 'file-updated'; path: string }
  | { type: 'error'; message: string }
  | { type: 'done'; status: string }

export function AgentPanel({ sessionId, onDone }: { sessionId: string; onDone?: (status: string) => void }) {
  const [events, setEvents] = useState<Event[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/api/agent-sessions/${sessionId}/stream`)
    wsRef.current = ws
    ws.addEventListener('message', (e: any) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'history') {
        setEvents(msg.events)
      } else {
        setEvents((prev) => [...prev, msg])
        if (msg.type === 'done') onDone?.(msg.status)
      }
    })
    return () => ws.close()
  }, [sessionId, onDone])

  const pendingQuestion = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type === 'question') return e
      if (e.type === 'message' || e.type === 'tool-result') return null
    }
    return null
  })()

  async function answer(label: string) {
    await fetch(`/api/agent-sessions/${sessionId}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: label }),
    })
    setEvents((prev) => [...prev, { type: 'message' as const, phase: 'system', role: 'user', content: `[answered] ${label}` }])
  }

  const grouped: Record<string, Event[]> = {}
  let currentPhase = 'init'
  for (const ev of events) {
    if (ev.type === 'phase-start') currentPhase = ev.phase
    ;(grouped[currentPhase] ??= []).push(ev)
  }

  return (
    <div data-testid="agent-panel" style={{ fontFamily: 'monospace', fontSize: 13 }}>
      {pendingQuestion && pendingQuestion.type === 'question' && (
        <div role="dialog" style={{ border: '2px solid #007', padding: 12, marginBottom: 12, background: '#1a1a2e' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{pendingQuestion.question}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pendingQuestion.options.map((opt) => (
              <button key={opt.label} onClick={() => answer(opt.label)}>{opt.label}</button>
            ))}
          </div>
        </div>
      )}
      {Object.entries(grouped).map(([phase, evs]) => (
        <div key={phase} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>▶ {phase}</div>
          {evs.map((ev, i) => (
            <div key={i} style={{ paddingLeft: 16 }}>
              {ev.type === 'tool-call' && <span>📞 {ev.name}({JSON.stringify(ev.args)})</span>}
              {ev.type === 'tool-result' && <span>{ev.ok ? '✓' : '✗'} {ev.name}: {ev.result.slice(0, 80)}</span>}
              {ev.type === 'message' && <span>💬 {ev.content.slice(0, 200)}</span>}
              {ev.type === 'file-updated' && <span>📝 {ev.path}</span>}
              {ev.type === 'error' && <span style={{ color: 'red' }}>{ev.message}</span>}
              {ev.type === 'phase-done' && <span>✓ done</span>}
              {ev.type === 'done' && <span>● {ev.status}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
