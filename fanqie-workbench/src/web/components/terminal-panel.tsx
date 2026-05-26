import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { fontSize, radius, spacing } from '../styles/tokens.js'

type QuestionPayload = {
  question: string
  options: Array<{ label: string; checked?: boolean }>
  multiSelect: boolean
}

export function TerminalPanel({
  sessionId,
  onDone,
}: {
  sessionId: string
  onDone?: (status: string) => void
}) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [question, setQuestion] = useState<QuestionPayload | null>(null)
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set())
  const [thinkingText, setThinkingText] = useState<string | null>(null)

  useEffect(() => {
    if (!termRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, 'Fira Code', monospace",
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: { background: '#1a1a2e' },
      convertEol: false,
      scrollback: 10000,
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(termRef.current)
    setTimeout(() => fitAddon.fit(), 0)
    terminalRef.current = terminal

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/api/sessions/${sessionId}/terminal`)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      fitAddon.fit()
      ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    })

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case 'output':
          terminal.write(msg.data)
          setThinkingText(null)
          break
        case 'question':
          setQuestion({ question: msg.question, options: msg.options, multiSelect: msg.multiSelect })
          if (msg.multiSelect && msg.options) {
            setSelectedOptions(new Set(msg.options.filter((o: any) => o.checked).map((o: any) => o.label)))
          } else {
            setSelectedOptions(new Set())
          }
          break
        case 'thinking':
          setThinkingText(msg.text)
          break
        case 'idle':
          setThinkingText(null)
          setQuestion(null)
          break
        case 'done':
          onDone?.(msg.status)
          break
        case 'history':
          break
      }
    })

    terminal.onData((data) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    const onResize = () => {
      fitAddon.fit()
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
      }
    }
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(termRef.current)

    return () => {
      resizeObserver.disconnect()
      ws.close()
      terminal.dispose()
    }
  }, [sessionId, onDone])

  const handleAnswer = (answer: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== 1) return
    ws.send(JSON.stringify({ type: 'answer', answer }))
    setQuestion(null)
    setSelectedOptions(new Set())
  }

  return (
    <div style={{ position: 'relative' }}>
      {thinkingText && (
        <div style={{
          padding: `${spacing.xs}px ${spacing.md}px`,
          background: 'var(--bg-elevated)',
          borderBottom: '1px solid var(--border)',
          fontSize: fontSize.sm,
          color: 'var(--text-muted)',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {thinkingText}
        </div>
      )}

      {question && (
        <div style={{
          position: 'absolute',
          top: thinkingText ? 32 : 0,
          left: 0,
          right: 0,
          zIndex: 10,
          background: 'rgba(26, 26, 46, 0.95)',
          border: '1px solid var(--accent)',
          borderRadius: radius.lg,
          padding: spacing.lg,
          margin: spacing.md,
        }}>
          <div style={{ fontSize: fontSize.md, fontWeight: 600, marginBottom: spacing.sm, color: 'var(--text-primary)' }}>
            {question.question}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {question.options.map((option) => {
              const isSelected = selectedOptions.has(option.label)
              return question.multiSelect ? (
                <button
                  key={option.label}
                  onClick={() => {
                    setSelectedOptions((prev) => {
                      const next = new Set(prev)
                      if (next.has(option.label)) next.delete(option.label)
                      else next.add(option.label)
                      return next
                    })
                  }}
                  style={{
                    textAlign: 'left',
                    padding: `${spacing.sm}px ${spacing.md}px`,
                    background: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                    color: isSelected ? 'white' : 'var(--text-primary)',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {isSelected ? '[✔] ' : '[ ] '}{option.label}
                </button>
              ) : (
                <button
                  key={option.label}
                  onClick={() => handleAnswer(option.label)}
                  style={{
                    textAlign: 'left',
                    padding: `${spacing.sm}px ${spacing.md}px`,
                    background: 'rgba(255,255,255,0.05)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {option.label}
                </button>
              )
            })}
            {question.multiSelect && (
              <button
                onClick={() => {
                  const nums = Array.from(selectedOptions).map(l => l.match(/^(\d+)\./)?.[1]).filter(Boolean)
                  const initialNums = question.options.filter(o => o.checked).map(o => o.label.match(/^(\d+)\./)?.[1]).filter(Boolean)
                  handleAnswer(`multi-final:${nums.join(',')}|initial:${initialNums.join(',')}|count:${question.options.length}`)
                }}
                disabled={selectedOptions.size === 0}
                style={{
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: radius.md,
                  fontWeight: 600,
                  cursor: selectedOptions.size === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedOptions.size === 0 ? 0.5 : 1,
                }}
              >
                确认选择（{selectedOptions.size} 项）
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={termRef}
        data-testid="terminal-container"
        style={{
          height: 520,
          background: '#1a1a2e',
          borderRadius: radius.lg,
          padding: 4,
          overflow: 'hidden',
        }}
      />
    </div>
  )
}
