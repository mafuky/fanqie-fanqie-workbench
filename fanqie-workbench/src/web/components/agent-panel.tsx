import { useEffect, useRef, useState } from 'react'

type Event =
  | { type: 'history'; events: Event[] }
  | { type: 'phase-start'; phase: string }
  | { type: 'phase-done'; phase: string }
  | { type: 'delta'; phase: string; content: string }
  | { type: 'tool-call-delta'; phase: string; toolCallIndex: number; id?: string; name?: string; argsFragment?: string }
  | { type: 'message'; phase: string; role: string; content: string }
  | { type: 'tool-call'; phase: string; toolCallId: string; name: string; args: any }
  | { type: 'tool-result'; phase: string; toolCallId: string; name: string; result: string; ok: boolean }
  | { type: 'question'; question: string; options: { label: string }[]; multiSelect: boolean }
  | { type: 'file-updated'; path: string }
  | { type: 'error'; message: string }
  | { type: 'done'; status: string }

interface InProgressTool {
  id: string
  name: string
  argsBuffer: string
}

export function AgentPanel({ sessionId, onDone }: { sessionId: string; onDone?: (status: string) => void }) {
  const [events, setEvents] = useState<Event[]>([])
  const [textBuffers, setTextBuffers] = useState<Record<string, string>>({})
  const [toolBuffers, setToolBuffers] = useState<Record<string, Record<number, InProgressTool>>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Auto-scroll to bottom when content grows, unless user has scrolled up away
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight
    }
  }, [events, textBuffers, toolBuffers])

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/api/agent-sessions/${sessionId}/stream`)
    wsRef.current = ws
    ws.addEventListener('message', (e: any) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'history') {
        setEvents(msg.events)
        return
      }
      if (msg.type === 'delta') {
        setTextBuffers((prev) => ({ ...prev, [msg.phase]: (prev[msg.phase] ?? '') + msg.content }))
        return
      }
      if (msg.type === 'tool-call-delta') {
        setToolBuffers((prev) => {
          const phaseMap = { ...(prev[msg.phase] ?? {}) }
          const existing = phaseMap[msg.toolCallIndex] ?? { id: '', name: '', argsBuffer: '' }
          phaseMap[msg.toolCallIndex] = {
            id: msg.id ?? existing.id,
            name: msg.name ?? existing.name,
            argsBuffer: existing.argsBuffer + (msg.argsFragment ?? ''),
          }
          return { ...prev, [msg.phase]: phaseMap }
        })
        return
      }
      if (msg.type === 'message') {
        // Final message replaces streaming buffer for this phase
        setTextBuffers((prev) => { const next = { ...prev }; delete next[msg.phase]; return next })
      }
      if (msg.type === 'tool-call' || msg.type === 'tool-result') {
        // Clear the in-progress tool buffer once the full event arrives
        setToolBuffers((prev) => {
          const phaseMap = { ...(prev[msg.phase] ?? {}) }
          // Clear the matching entry by id
          for (const idx of Object.keys(phaseMap)) {
            if (phaseMap[Number(idx)].id === msg.toolCallId) delete phaseMap[Number(idx)]
          }
          return { ...prev, [msg.phase]: phaseMap }
        })
      }
      setEvents((prev) => [...prev, msg])
      if (msg.type === 'done') onDone?.(msg.status)
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
    <div
      data-testid="agent-panel"
      ref={scrollRef}
      style={{
        fontFamily: 'monospace',
        fontSize: 13,
        maxHeight: 520,
        overflowY: 'auto',
        overflowX: 'hidden',
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        padding: 8,
      }}
    >
      {pendingQuestion && pendingQuestion.type === 'question' && (
        <div role="dialog" style={{ position: 'sticky', top: 0, zIndex: 1, border: '2px solid #007', padding: 12, marginBottom: 12, background: '#1a1a2e' }}>
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
              {ev.type === 'tool-call' && <span>📞 {ev.name}({JSON.stringify(ev.args).slice(0, 200)})</span>}
              {ev.type === 'tool-result' && <span>{ev.ok ? '✓' : '✗'} {ev.name}: {ev.result.slice(0, 80)}</span>}
              {ev.type === 'message' && <span>💬 {ev.content.slice(0, 400)}</span>}
              {ev.type === 'file-updated' && <span>📝 {ev.path}</span>}
              {ev.type === 'error' && <span style={{ color: 'red' }}>{ev.message}</span>}
              {ev.type === 'phase-done' && <span>✓ done</span>}
              {ev.type === 'done' && <span>● {ev.status}</span>}
            </div>
          ))}
          {/* In-progress streaming text */}
          {textBuffers[phase] && (
            <div style={{ paddingLeft: 16, opacity: 0.85, whiteSpace: 'pre-wrap' }}>
              💬 {textBuffers[phase]}<span style={{ animation: 'blink 1s infinite' }}>▊</span>
            </div>
          )}
          {/* In-progress streaming tool args */}
          {toolBuffers[phase] && Object.entries(toolBuffers[phase]).map(([idx, tool]) => (
            <div key={`tool-${idx}`} style={{ paddingLeft: 16, opacity: 0.85, whiteSpace: 'pre-wrap' }}>
              📞 {tool.name}(<span>{tool.argsBuffer}</span><span style={{ animation: 'blink 1s infinite' }}>▊</span>
            </div>
          ))}
        </div>
      ))}

      {/* Render in-progress buffers for phases not yet in grouped (phase-start not yet fired) */}
      {Object.entries(textBuffers)
        .filter(([phase]) => !grouped[phase])
        .map(([phase, text]) => (
          <div key={`buf-${phase}`} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>▶ {phase}</div>
            <div style={{ paddingLeft: 16, opacity: 0.85, whiteSpace: 'pre-wrap' }}>
              💬 {text}<span style={{ animation: 'blink 1s infinite' }}>▊</span>
            </div>
          </div>
        ))}
    </div>
  )
}
