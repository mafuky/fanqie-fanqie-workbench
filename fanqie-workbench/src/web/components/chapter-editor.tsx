import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { spacing, fontSize, radius } from '../styles/tokens.js'
import { diffChars } from '../lib/diff.js'

// A selection up to this many chars can be sent for rewrite (multi-line / multi-sentence OK).
const MAX_REVISE_CHARS = 2000

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

  // Selection AI rewrite: select a span (multi-line OK) → AI bar → candidate list →
  // pick one → diff preview → accept → replace + toast.
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null)
  const [revising, setRevising] = useState<SentenceMode | null>(null)
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [reviseError, setReviseError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function clearRevise() {
    setSel(null)
    setCandidates(null)
    setPreviewIndex(null)
    setReviseError(null)
  }

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast((current) => (current === message ? null : current)), 2400)
  }

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
    // Use the raw selection span (so replacement is precise); trim only to test emptiness.
    const raw = content.slice(start, end)
    if (end > start && raw.trim().length > 0 && raw.length <= MAX_REVISE_CHARS) {
      setSel({ start, end, text: raw })
      setCandidates(null)
      setPreviewIndex(null)
      setReviseError(null)
    } else {
      clearRevise()
    }
  }

  async function reviseSelection(mode: SentenceMode) {
    if (!sel) return
    setRevising(mode)
    setReviseError(null)
    setCandidates(null)
    setPreviewIndex(null)
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

  function acceptCandidate(text: string) {
    if (!sel) return
    const changed = text.length - sel.text.length
    setContent(content.slice(0, sel.start) + text + content.slice(sel.end))
    clearRevise()
    showToast(changed >= 0 ? `已应用改写（+${changed} 字）` : `已应用改写（${changed} 字）`)
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

      {toast && (
        <div data-testid="editor-toast" style={{ marginBottom: spacing.sm, padding: '6px 12px', borderRadius: radius.md, background: '#243027', color: '#b9d1ae', border: '1px solid #36483a', fontSize: fontSize.sm, width: 'fit-content' }}>
          {toast}
        </div>
      )}

      {sel && (
        <div data-testid="sentence-ai-bar" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.sm, borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
          <span style={{ fontSize: fontSize.sm, color: 'var(--text-muted)' }}>对选中片段：</span>
          {SENTENCE_MODES.map((m) => (
            <button key={m.key} disabled={revising !== null} onClick={() => void reviseSelection(m.key)} style={{ padding: '4px 10px', borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: revising !== null ? 'default' : 'pointer', fontSize: fontSize.sm }}>
              {revising === m.key ? '改写中…' : m.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={clearRevise} title="关闭" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: fontSize.md }}>×</button>
        </div>
      )}
      {reviseError && <div style={{ marginBottom: spacing.sm, color: 'var(--red)', fontSize: fontSize.sm }}>{reviseError}</div>}

      {/* Candidate list — pick one to preview its diff (no replacement yet). */}
      {candidates && previewIndex === null && (
        <div data-testid="sentence-candidates" style={{ display: 'grid', gap: spacing.xs, marginBottom: spacing.sm }}>
          {candidates.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: fontSize.sm }}>没有候选，换个说法再试。</div>}
          {candidates.map((c, i) => (
            <button key={i} onClick={() => setPreviewIndex(i)} style={{ textAlign: 'left', padding: spacing.sm, borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: fontSize.sm, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              候选 {i + 1}：{c}
            </button>
          ))}
        </div>
      )}

      {/* Diff preview for the picked candidate — accept to replace, or go back / discard. */}
      {candidates && previewIndex !== null && sel && (
        <div data-testid="sentence-diff" style={{ marginBottom: spacing.sm, padding: spacing.sm, borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
          <div style={{ fontSize: fontSize.sm, color: 'var(--text-muted)', marginBottom: spacing.xs }}>改动预览（<span style={{ color: '#e0a29b' }}>红=删</span> / <span style={{ color: '#b9d1ae' }}>绿=增</span>）：</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: fontSize.sm, marginBottom: spacing.sm }}>
            {diffChars(sel.text, candidates[previewIndex]).map((part, i) => (
              <span
                key={i}
                style={
                  part.type === 'del'
                    ? { background: '#3a2422', color: '#e0a29b', textDecoration: 'line-through' }
                    : part.type === 'ins'
                      ? { background: '#23301f', color: '#b9d1ae' }
                      : undefined
                }
              >
                {part.text}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <button onClick={() => acceptCandidate(candidates[previewIndex])} style={{ padding: '4px 14px', borderRadius: radius.md, border: 'none', background: 'var(--accent)', color: 'white', cursor: 'pointer', fontSize: fontSize.sm }}>接受</button>
            <button onClick={() => setPreviewIndex(null)} style={{ padding: '4px 14px', borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: fontSize.sm }}>换一个</button>
            <button onClick={clearRevise} style={{ padding: '4px 14px', borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: fontSize.sm }}>放弃</button>
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        aria-label="章节正文"
        value={content}
        onSelect={updateSelection}
        onChange={(event) => { setContent(event.currentTarget.value); clearRevise() }}
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
