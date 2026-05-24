import { useState } from 'react'
import { fontSize, radius, spacing } from '../styles/tokens.js'

export type PermissionPromptDetection = {
  kind: 'bash-permission'
  title: string
  excerpt: string
  recommendation: string
  terminalInstruction: string
}

type PermissionChoice = 'allow-once' | 'deny'

export function PermissionPromptCard({
  detection,
  sessionId,
  onHandled,
}: {
  detection: PermissionPromptDetection
  sessionId?: string | null
  onHandled?: (choice: PermissionChoice) => void
}) {
  const [submitting, setSubmitting] = useState<PermissionChoice | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (choice: PermissionChoice) => {
    if (!sessionId) return
    setSubmitting(choice)
    setError(null)
    try {
      const response = await fetch(`/api/sessions/${sessionId}/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error || '权限处理失败')
        return
      }
      onHandled?.(choice)
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <section style={{
      border: '1px solid var(--yellow, #d99a00)',
      borderRadius: radius.lg,
      padding: spacing.lg,
      background: 'var(--bg-elevated)',
      display: 'grid',
      gap: spacing.md,
    }}>
      <div>
        <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>权限提示助手</div>
        <h3 style={{ margin: 0, fontSize: fontSize.lg }}>{detection.title}</h3>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: spacing.xs }}>终端提示摘录</div>
        <pre style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: radius.md,
          padding: spacing.md,
          fontSize: fontSize.sm,
        }}>{detection.excerpt}</pre>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: spacing.xs }}>建议</div>
        <div>{detection.recommendation}</div>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: spacing.xs }}>你可以直接处理</div>
        <div>{detection.terminalInstruction}</div>
      </div>

      {error && <div style={{ color: 'var(--red)', fontSize: fontSize.sm }}>{error}</div>}

      {sessionId && (
        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
          <button
            onClick={() => void submit('allow-once')}
            disabled={submitting !== null}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radius.md,
              border: 'none',
              background: 'var(--accent)',
              color: 'white',
              opacity: submitting !== null ? 0.6 : 1,
              cursor: submitting !== null ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting === 'allow-once' ? '允许中…' : '允许本次'}
          </button>
          <button
            onClick={() => void submit('deny')}
            disabled={submitting !== null}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radius.md,
              border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              opacity: submitting !== null ? 0.6 : 1,
              cursor: submitting !== null ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting === 'deny' ? '拒绝中…' : '拒绝'}
          </button>
        </div>
      )}
    </section>
  )
}
