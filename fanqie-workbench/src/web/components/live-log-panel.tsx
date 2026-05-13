import { useEffect, useRef, useState } from 'react'

export function LiveLogPanel({ taskId, onDone }: { taskId: string; onDone?: (status: string) => void }) {
  const [lines, setLines] = useState<Array<{ stream: string; text: string }>>([])
  const containerRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    setLines([])
    const eventSource = new EventSource(`/api/tasks/${taskId}/stream`)

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setLines((prev) => [...prev, { stream: data.stream, text: data.chunk }])
    }

    eventSource.addEventListener('done', (event) => {
      const data = JSON.parse((event as MessageEvent).data)
      onDone?.(data.status)
      eventSource.close()
    })

    eventSource.onerror = () => {
      eventSource.close()
    }

    return () => {
      eventSource.close()
    }
  }, [taskId, onDone])

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines])

  return (
    <pre
      ref={containerRef}
      style={{
        background: '#0d1117',
        color: '#c9d1d9',
        padding: 16,
        borderRadius: 6,
        border: '1px solid #30363d',
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        maxHeight: 500,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {lines.length === 0 && <span style={{ color: '#484f58' }}>等待输出...</span>}
      {lines.map((line, i) => (
        <span key={i} style={{ color: line.stream === 'stderr' ? '#f85149' : '#c9d1d9' }}>
          {line.text}
        </span>
      ))}
    </pre>
  )
}
