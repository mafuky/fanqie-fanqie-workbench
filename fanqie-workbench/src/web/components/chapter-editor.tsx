import { useCallback, useEffect, useMemo, useState } from 'react'
import { spacing, fontSize, radius } from '../styles/tokens.js'

export function ChapterEditor({ chapterId, reloadKey = 0, onSaved }: { chapterId: string; reloadKey?: number; onSaved?: () => void }) {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/chapters/${chapterId}/content`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || '加载章节失败')
        return data
      })
      .then((data) => {
        if (cancelled) return
        setContent(data.content ?? '')
        setSavedContent(data.content ?? '')
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
  }, [chapterId])

  useEffect(() => load(), [load, reloadKey, loadAttempt])

  const dirty = content !== savedContent
  const wordCount = useMemo(() => content.replace(/\s/g, '').length, [content])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/chapters/${chapterId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        if (res.status === 409) {
          setError('Claude 正在修改本书，暂时不能覆盖保存。')
          return
        }
        const body = await res.json().catch(() => ({}))
        setError(body.error || '保存失败')
        return
      }
      setSavedContent(content)
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>正在加载章节…</div>

  if (error && !content) {
    return (
      <section style={{ display: 'grid', gap: spacing.sm, color: 'var(--text-muted)' }}>
        <div style={{ color: 'var(--red)' }}>{error}</div>
        <button onClick={() => setLoadAttempt((value) => value + 1)} style={{ width: 'fit-content', padding: '8px 14px', borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
          重试
        </button>
      </section>
    )
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
        <span style={{ fontSize: fontSize.sm, color: 'var(--text-muted)' }}>字数：{wordCount}</span>
        <span style={{ flex: 1 }} />
        {dirty && <span style={{ fontSize: fontSize.sm, color: 'var(--accent)' }}>未保存</span>}
        <button onClick={() => void save()} disabled={saving || !dirty} style={{ padding: '8px 14px', borderRadius: radius.md, border: 'none', background: 'var(--accent)', color: 'white', opacity: saving || !dirty ? 0.6 : 1 }}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      {error && <div style={{ marginBottom: spacing.sm, color: 'var(--red)', fontSize: fontSize.sm }}>{error}</div>}
      <textarea
        aria-label="章节正文"
        value={content}
        onChange={(event) => setContent(event.currentTarget.value)}
        style={{
          flex: 1,
          minHeight: 520,
          padding: spacing.lg,
          borderRadius: radius.lg,
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          fontSize: fontSize.md,
          lineHeight: 1.8,
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
    </section>
  )
}
