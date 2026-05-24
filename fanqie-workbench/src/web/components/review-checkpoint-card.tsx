import { useEffect, useState } from 'react'
import { fontSize, radius, spacing } from '../styles/tokens.js'

type ReviewAction = 'accept' | 'deslop' | 'rewrite' | 'continue-next' | 'save-only'

type ReviewCheckpoint = {
  id: string
  title: string
  summary: {
    completed: string[]
    checks: string[]
  }
  changedFiles: string[]
  options: ReviewAction[]
  status: string
}

const actionLabels: Record<ReviewAction, string> = {
  accept: '接受',
  deslop: '去 AI 味',
  rewrite: '回炉重写',
  'continue-next': '继续下一章',
  'save-only': '只保存，不继续',
}

export function ReviewCheckpointCard({
  sessionId,
  sessionStatus,
  reloadKey = 0,
  onResolved,
}: {
  sessionId: string | null
  sessionStatus?: string | null
  reloadKey?: number
  onResolved?: () => void
}) {
  const [checkpoint, setCheckpoint] = useState<ReviewCheckpoint | null>(null)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [resolvingAction, setResolvingAction] = useState<ReviewAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId || sessionStatus === 'waiting-answer') {
      setCheckpoint(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/sessions/${sessionId}/review-checkpoint`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || '加载审阅点失败')
        if (!cancelled) setCheckpoint(body.checkpoint ?? null)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, sessionStatus, reloadKey])

  const resolve = async (action: ReviewAction) => {
    if (!checkpoint) return
    setResolvingAction(action)
    setError(null)
    try {
      const response = await fetch(`/api/review-checkpoints/${checkpoint.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || '处理审阅点失败')
        return
      }
      setCheckpoint(null)
      setComment('')
      onResolved?.()
    } finally {
      setResolvingAction(null)
    }
  }

  if (!sessionId || sessionStatus === 'waiting-answer') return null
  if (loading && !checkpoint) return null
  if (!checkpoint && !error) return null

  return (
    <section style={{
      border: '1px solid var(--accent)',
      borderRadius: radius.lg,
      padding: spacing.lg,
      background: 'var(--bg-elevated)',
      display: 'grid',
      gap: spacing.md,
    }}>
      <div>
        <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>阶段审阅</div>
        <h3 style={{ margin: 0, fontSize: fontSize.lg }}>{checkpoint?.title || '审阅点加载失败'}</h3>
      </div>

      {error && <div style={{ color: 'var(--red)', fontSize: fontSize.sm }}>{error}</div>}

      {checkpoint && (
        <>
          <div>
            <div style={{ fontWeight: 600, marginBottom: spacing.xs }}>Claude 已完成</div>
            <ul style={{ margin: 0, paddingLeft: spacing.lg }}>
              {checkpoint.summary.completed.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>

          {checkpoint.summary.checks.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: spacing.xs }}>自检结果</div>
              <ul style={{ margin: 0, paddingLeft: spacing.lg }}>
                {checkpoint.summary.checks.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}

          {checkpoint.changedFiles.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: spacing.xs }}>变更文件</div>
              <ul style={{ margin: 0, paddingLeft: spacing.lg, color: 'var(--text-muted)', fontSize: fontSize.sm }}>
                {checkpoint.changedFiles.map((file) => <li key={file}>{file}</li>)}
              </ul>
            </div>
          )}

          <textarea
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
            placeholder="给回炉、去 AI 味或下一步补充要求…"
            style={{
              minHeight: 72,
              padding: spacing.sm,
              borderRadius: radius.md,
              border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
            }}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
            {checkpoint.options.map((action) => (
              <button
                key={action}
                onClick={() => void resolve(action)}
                disabled={resolvingAction !== null}
                style={{
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  borderRadius: radius.md,
                  border: action === 'accept' ? 'none' : '1px solid var(--border)',
                  background: action === 'accept' ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: action === 'accept' ? 'white' : 'var(--text-primary)',
                  opacity: resolvingAction !== null ? 0.6 : 1,
                }}
              >
                {resolvingAction === action ? '处理中…' : actionLabels[action]}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
