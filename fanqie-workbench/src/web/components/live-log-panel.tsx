import { useEffect, useRef, useState } from 'react'
import { fontSize, radius, spacing } from '../styles/tokens.js'

type QuestionPayload = {
  toolUseId: string
  question: string
  options: Array<{ label: string; description?: string; checked?: boolean }>
  multiSelect?: boolean
}

type PermissionPromptPayload = {
  kind: 'bash-permission'
  title: string
  excerpt: string
  recommendation: string
  terminalInstruction: string
}

type LogChunk = {
  id?: number
  stream: string
  text: string
}

export function LiveLogPanel({
  taskId,
  onDone,
  onChunk,
  onAnswerSubmitted,
  onPermissionBlocked,
  streamBase = 'tasks',
}: {
  taskId: string
  onDone?: (status: string) => void
  onChunk?: (chunk: LogChunk) => void
  onAnswerSubmitted?: (answer: string) => void
  onPermissionBlocked?: (payload: PermissionPromptPayload) => void
  streamBase?: 'tasks' | 'sessions'
}) {
  const [lines, setLines] = useState<LogChunk[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [question, setQuestion] = useState<QuestionPayload | null>(null)
  const [customAnswer, setCustomAnswer] = useState('')
  const [answering, setAnswering] = useState(false)
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set())
  const [thinkingText, setThinkingText] = useState<string | null>(null)
  const containerRef = useRef<HTMLPreElement>(null)
  const startRef = useRef(Date.now())
  const seenMessageIdsRef = useRef<Set<number>>(new Set())
  const onDoneRef = useRef(onDone)
  const onChunkRef = useRef(onChunk)
  const onAnswerSubmittedRef = useRef(onAnswerSubmitted)
  const onPermissionBlockedRef = useRef(onPermissionBlocked)
  onDoneRef.current = onDone
  onChunkRef.current = onChunk
  onAnswerSubmittedRef.current = onAnswerSubmitted
  onPermissionBlockedRef.current = onPermissionBlocked

  useEffect(() => {
    seenMessageIdsRef.current = new Set()
    setLines([])
    setQuestion(null)
    setCustomAnswer('')
    setAnswerError(null)
    setSelectedOptions(new Set())
    startRef.current = Date.now()
    setElapsed(0)

    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)

    const eventSource = new EventSource(`/api/${streamBase}/${taskId}/stream`)

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data) as { id?: number; stream: string; chunk: string }
      if (typeof data.id === 'number') {
        if (seenMessageIdsRef.current.has(data.id)) return
        seenMessageIdsRef.current.add(data.id)
      }
      const nextChunk = { id: data.id, stream: data.stream, text: data.chunk }
      setLines((prev) => [...prev, nextChunk])
      onChunkRef.current?.(nextChunk)
    }

    eventSource.addEventListener('question', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as QuestionPayload
      setQuestion(data)
      if (data.multiSelect && data.options) {
        const preChecked = new Set(data.options.filter((o) => o.checked).map((o) => o.label))
        setSelectedOptions(preChecked)
      } else {
        setSelectedOptions(new Set())
      }
    })

    eventSource.addEventListener('thinking', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { text: string }
      setThinkingText(data.text)
    })

    eventSource.addEventListener('permission-blocked', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as PermissionPromptPayload
      onPermissionBlockedRef.current?.(data)
    })

    eventSource.addEventListener('done', (event) => {
      const data = JSON.parse((event as MessageEvent).data)
      setThinkingText(null)
      clearInterval(timer)
      onDoneRef.current?.(data.status)
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
  }, [taskId, streamBase])

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines])

  const handleAnswer = async (answer: string) => {
    const nextAnswer = answer.trim()
    if (!nextAnswer) return

    setAnswering(true)
    setAnswerError(null)
    try {
      const res = await fetch(`/api/${streamBase}/${taskId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: nextAnswer }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAnswerError(data.error || '提交回答失败')
        return
      }
      setQuestion(null)
      setCustomAnswer('')
      onAnswerSubmittedRef.current?.(nextAnswer)
    } finally {
      setAnswering(false)
    }
  }

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

      {question && (
        <div style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--accent)',
          padding: spacing.lg,
          borderRadius: radius.lg,
          marginBottom: spacing.md,
        }}>
          <div style={{ fontSize: fontSize.md, fontWeight: 600, marginBottom: spacing.sm }}>
            {question.question}
          </div>
          {question.multiSelect && (
            <div style={{ fontSize: fontSize.sm, color: 'var(--text-muted)', marginBottom: spacing.sm }}>
              可多选，选好后点「确认选择」
            </div>
          )}
          {answerError && <div style={{ color: 'var(--red)', fontSize: fontSize.sm, marginBottom: spacing.sm }}>{answerError}</div>}
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
                  disabled={answering}
                  style={{
                    textAlign: 'left',
                    padding: `${spacing.sm}px ${spacing.md}px`,
                    background: isSelected ? 'var(--accent)' : 'var(--bg-secondary)',
                    color: isSelected ? 'white' : 'var(--text-primary)',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: radius.md,
                    cursor: answering ? 'not-allowed' : 'pointer',
                    opacity: answering ? 0.6 : 1,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {isSelected ? '[✔] ' : '[ ] '}{option.label}
                  </div>
                  {option.description && (
                    <div style={{ fontSize: fontSize.sm, color: isSelected ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)', marginTop: 2 }}>
                      {option.description}
                    </div>
                  )}
                </button>
              ) : (
                <button
                  key={option.label}
                  onClick={() => handleAnswer(option.label)}
                  disabled={answering}
                  style={{
                    textAlign: 'left',
                    padding: `${spacing.sm}px ${spacing.md}px`,
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: radius.md,
                    cursor: answering ? 'not-allowed' : 'pointer',
                    opacity: answering ? 0.6 : 1,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{option.label}</div>
                  {option.description && (
                    <div style={{ fontSize: fontSize.sm, color: 'var(--text-muted)', marginTop: 2 }}>
                      {option.description}
                    </div>
                  )}
                </button>
              )
            })}
            {question.multiSelect && (
              <button
                onClick={() => {
                  const desiredNums = Array.from(selectedOptions)
                    .map((l) => l.match(/^(\d+)\./)?.[1])
                    .filter(Boolean)
                    .map(Number)
                  const initialNums = question.options
                    .filter((o) => o.checked)
                    .map((o) => o.label.match(/^(\d+)\./)?.[1])
                    .filter(Boolean)
                    .map(Number)
                  const totalCount = question.options.length
                  void handleAnswer(`multi-final:${desiredNums.join(',')}|initial:${initialNums.join(',')}|count:${totalCount}`)
                }}
                disabled={answering || selectedOptions.size === 0}
                style={{
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: radius.md,
                  fontWeight: 600,
                  cursor: answering || selectedOptions.size === 0 ? 'not-allowed' : 'pointer',
                  opacity: answering || selectedOptions.size === 0 ? 0.6 : 1,
                }}
              >
                确认选择（{selectedOptions.size} 项）
              </button>
            )}
            <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={customAnswer}
                onChange={(event) => setCustomAnswer(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !answering) {
                    event.preventDefault()
                    void handleAnswer(customAnswer)
                  }
                }}
                placeholder="输入你的回答…"
                disabled={answering}
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: radius.md,
                  fontFamily: 'inherit',
                  opacity: answering ? 0.6 : 1,
                }}
              />
              <button
                onClick={() => void handleAnswer(customAnswer)}
                disabled={answering || !customAnswer.trim()}
                style={{
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: radius.md,
                  cursor: answering || !customAnswer.trim() ? 'not-allowed' : 'pointer',
                  opacity: answering || !customAnswer.trim() ? 0.6 : 1,
                }}
              >
                提交回答
              </button>
            </div>
          </div>
        </div>
      )}

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
