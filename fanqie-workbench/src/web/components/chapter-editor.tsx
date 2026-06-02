import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { spacing, fontSize, radius } from '../styles/tokens.js'

type SentenceMode = 'polish' | 'deslop' | 'expand'
const SENTENCE_MODES: { key: SentenceMode; label: string }[] = [
  { key: 'polish', label: '润色/换说法' },
  { key: 'deslop', label: '去AI味' },
  { key: 'expand', label: '扩写·加画面' },
]

export function ChapterEditor({ chapterId, reloadKey = 0, onSaved }: { chapterId: string; reloadKey?: number; onSaved?: () => void }) {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  // Sentence-level AI rewrite: select (swipe) a sentence → AI bar → candidates → replace.
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null)
  const [revising, setRevising] = useState<SentenceMode | null>(null)
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [reviseError, setReviseError] = useState<string | null>(null)

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

  function updateSelection() {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const text = content.slice(start, end).trim()
    if (end > start && text.length > 0 && text.length <= 200) {
      setSel({ start, end, text })
    } else {
      setSel(null)
      setCandidates(null)
      setReviseError(null)
    }
  }

  async function reviseSelection(mode: SentenceMode) {
    if (!sel) return
    setRevising(mode)
    setReviseError(null)
    setCandidates(null)
    const context = content.slice(Math.max(0, sel.start - 150), Math.min(content.length, sel.end + 150))
    try {
      const res = await fetch('/api/sentence/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: sel.text, context, mode }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || '改写失败')
      setCandidates(Array.isArray(body.candidates) ? body.candidates : [])
    } catch (e) {
      setReviseError(e instanceof Error ? e.message : '改写失败')
    } finally {
      setRevising(null)
    }
  }

  function applyCandidate(text: string) {
    if (!sel) return
    setContent(content.slice(0, sel.start) + text + content.slice(sel.end))
    setSel(null)
    setCandidates(null)
    setReviseError(null)
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

      {sel && (
        <div data-testid="sentence-ai-bar" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.sm, borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
          <span style={{ fontSize: fontSize.sm, color: 'var(--text-muted)' }}>对选中句：</span>
          {SENTENCE_MODES.map((m) => (
            <button key={m.key} disabled={revising !== null} onClick={() => void reviseSelection(m.key)} style={{ padding: '4px 10px', borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: revising !== null ? 'default' : 'pointer', fontSize: fontSize.sm }}>
              {revising === m.key ? '改写中…' : m.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={() => { setSel(null); setCandidates(null); setReviseError(null) }} title="关闭" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: fontSize.md }}>×</button>
        </div>
      )}
      {reviseError && <div style={{ marginBottom: spacing.sm, color: 'var(--red)', fontSize: fontSize.sm }}>{reviseError}</div>}
      {candidates && (
        <div data-testid="sentence-candidates" style={{ display: 'grid', gap: spacing.xs, marginBottom: spacing.sm }}>
          {candidates.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: fontSize.sm }}>没有候选，换个说法再试。</div>}
          {candidates.map((c, i) => (
            <button key={i} onClick={() => applyCandidate(c)} style={{ textAlign: 'left', padding: spacing.sm, borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: fontSize.sm, lineHeight: 1.6 }}>
              {c}
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        aria-label="章节正文"
        value={content}
        onSelect={updateSelection}
        onChange={(event) => { setContent(event.currentTarget.value); setSel(null); setCandidates(null) }}
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
