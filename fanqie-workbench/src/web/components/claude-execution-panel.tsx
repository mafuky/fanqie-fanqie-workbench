import { useEffect, useState } from 'react'
import { LiveLogPanel } from './live-log-panel.js'
import { PermissionPromptCard, type PermissionPromptDetection } from './permission-prompt-card.js'
import { ReviewCheckpointCard } from './review-checkpoint-card.js'
import { spacing, fontSize, radius } from '../styles/tokens.js'

export function ClaudeExecutionPanel({
  sessionId,
  sessionStatus,
  actionLabel,
  onDone,
  onInterrupted,
  onAnswerSubmitted,
}: {
  sessionId: string | null
  sessionStatus?: string | null
  actionLabel?: string
  onDone?: (status: string) => void
  onInterrupted?: () => void
  onAnswerSubmitted?: (answer: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [permissionPrompt, setPermissionPrompt] = useState<PermissionPromptDetection | null>(null)
  const [reviewReloadKey, setReviewReloadKey] = useState(0)

  useEffect(() => {
    setPermissionPrompt(null)
  }, [sessionId])

  const handleDone = (status: string) => {
    setReviewReloadKey((value) => value + 1)
    onDone?.(status)
  }

  const stop = async () => {
    if (!sessionId) return
    setStopping(true)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/interrupt`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || '停止失败')
        return
      }
      onInterrupted?.()
    } finally {
      setStopping(false)
    }
  }

  if (!sessionId) {
    return (
      <aside style={{ padding: spacing.lg, border: '1px dashed var(--border)', borderRadius: radius.lg, color: 'var(--text-muted)' }}>
        还没有运行中的 Claude 动作。
      </aside>
    )
  }

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        <div>
          <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>当前动作</div>
          <h2 style={{ margin: 0, fontSize: fontSize.lg }}>{actionLabel || 'Claude 执行中'}</h2>
        </div>
        <span style={{ flex: 1 }} />
        <button onClick={() => void stop()} disabled={stopping} style={{ padding: '8px 12px', borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', opacity: stopping ? 0.6 : 1 }}>
          {stopping ? '停止中…' : '停止'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--red)', fontSize: fontSize.sm }}>{error}</div>}
      {permissionPrompt && (
        <PermissionPromptCard
          detection={permissionPrompt}
          sessionId={sessionId}
          onHandled={() => setPermissionPrompt(null)}
        />
      )}
      {(sessionStatus === 'waiting-review' || reviewReloadKey > 0) && (
        <ReviewCheckpointCard
          sessionId={sessionId}
          sessionStatus={sessionStatus}
          reloadKey={reviewReloadKey}
          onResolved={() => {
            setReviewReloadKey((value) => value + 1)
            onDone?.('review-resolved')
          }}
        />
      )}
      <LiveLogPanel
        taskId={sessionId}
        streamBase="sessions"
        onDone={handleDone}
        onAnswerSubmitted={onAnswerSubmitted}
        onPermissionBlocked={setPermissionPrompt}
      />
    </aside>
  )
}
