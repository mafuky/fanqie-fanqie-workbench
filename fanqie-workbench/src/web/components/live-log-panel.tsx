import { useEffect, useRef, useState } from 'react'
import { fontSize, radius, spacing } from '../styles/tokens.js'

export function LiveLogPanel({ taskId, onDone }: { taskId: string; onDone?: (status: string) => void }) {
  const [lines, setLines] = useState<Array<{ stream: string; text: string }>>([])
  const [elapsed, setElapsed] = useState(0)
  const containerRef = useRef<HTMLPreElement>(null)
  const startRef = useRef(Date.now())

  useEffect(() => {
    setLines([])
    startRef.current = Date.now()
    setElapsed(0)

    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)

    const eventSource = new EventSource(`/api/tasks/${taskId}/stream`)

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setLines((prev) => [...prev, { stream: data.stream, text: data.chunk }])
    }

    eventSource.addEventListener('done', (event) => {
      const data = JSON.parse((event as MessageEvent).data)
      clearInterval(timer)
      onDone?.(data.status)
      eventSource.close()
    })

    eventSource.onerror = () => {
      clearInterval(timer)
      eventSource.close()
    }

    return () => {
      clearInterval(timer)
      eventSource.close()
    }
  }, [taskId, onDone])

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines])

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        marginBottom: spacing.md - 2,
      }}>
        <h3 style={{ fontSize: fontSize.md, fontWeight: 600, color: 'var(--text-secondary)' }}>
          执行日志
        </h3>
        <span style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--accent)',
          animation: 'ui-pulse 1.5s ease-in-out infinite',
        }} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>
          {elapsed}s
        </span>
      </div>
      <pre
        ref={containerRef}
        style={{
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          padding: spacing.xl,
          borderRadius: radius.lg,
          border: '1px solid var(--border)',
          fontSize: fontSize.md,
          fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
          lineHeight: 1.7,
          maxHeight: 520,
          minHeight: 200,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {lines.length === 0 && (
          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>等待输出...</span>
        )}
        {lines.map((line, i) => (
          <span key={i} style={{ color: line.stream === 'stderr' ? 'var(--red)' : 'var(--text-primary)' }}>
            {line.text}
          </span>
        ))}
      </pre>
    </div>
  )
}
