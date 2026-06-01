import { useEffect, useRef, useState } from 'react'
import { Modal } from './ui/modal.js'
import { Button } from './ui/button.js'
import { fontSize, radius, spacing } from '../styles/tokens.js'

export type CoverModalBook = { id: string; title: string }

/**
 * Cover workflow modal. Primary path is auto-generation (needs an image key);
 * the manual fallback gives the user a genre-matched prompt to paste into
 * ChatGPT, then accepts the resulting image pasted/dropped/uploaded back.
 */
export function CoverModal({
  open,
  book,
  onClose,
  onSaved,
}: {
  open: boolean
  book: CoverModalBook | null
  onClose: () => void
  onSaved?: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const [promptError, setPromptError] = useState<string | null>(null)
  const [imageData, setImageData] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !book) {
      setPrompt(''); setPromptError(null); setImageData(null)
      setSaving(false); setAutoBusy(false); setMessage(null); setError(null); setCopied(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(`/api/books/${book.id}/cover/prompt`)
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) { setPromptError(body.error ?? '获取提示词失败'); return }
        setPrompt(body.prompt ?? '')
      } catch (e: any) {
        if (!cancelled) setPromptError(e?.message ?? '获取提示词失败')
      }
    })()
    return () => { cancelled = true }
  }, [open, book])

  function readImageFile(file: File | null | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('请粘贴/上传图片文件'); return }
    setError(null)
    const reader = new FileReader()
    reader.onload = () => setImageData(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => setError('读取图片失败')
    reader.readAsDataURL(file)
  }

  async function copyPrompt() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { setError('复制失败，请手动选中复制') }
  }

  async function saveUpload() {
    if (!book || !imageData) return
    setSaving(true); setError(null); setMessage(null)
    try {
      const r = await fetch(`/api/books/${book.id}/cover/upload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: imageData }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) { setError(body.error ?? '封面保存失败'); return }
      setMessage(`封面已保存：${body.path ?? '封面.png'}`)
      onSaved?.()
    } catch (e: any) {
      setError(e?.message ?? '封面保存失败')
    } finally { setSaving(false) }
  }

  async function autoGenerate() {
    if (!book) return
    setAutoBusy(true); setError(null); setMessage(null)
    try {
      const r = await fetch(`/api/books/${book.id}/cover`, { method: 'POST' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError((body.error ?? '自动生成失败') + '（没有图像账号时请用下方手动方式）')
        return
      }
      setMessage(`封面已自动生成：${body.path ?? '封面.png'}`)
      onSaved?.()
    } catch (e: any) {
      setError(e?.message ?? '自动生成失败')
    } finally { setAutoBusy(false) }
  }

  if (!open || !book) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`生成封面 · 《${book.title}》`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
          <Button data-testid="cover-save" onClick={() => void saveUpload()} disabled={!imageData} loading={saving}>
            {saving ? '保存中…' : '保存为封面'}
          </Button>
        </>
      }
    >
      <div data-testid="cover-modal" style={{ display: 'grid', gap: spacing.lg, minWidth: 380 }}>
        {/* Step 1: prompt to copy */}
        <div style={{ display: 'grid', gap: spacing.sm }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <strong style={{ fontSize: fontSize.sm }}>① 复制提示词，粘到 ChatGPT 出图</strong>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="secondary" onClick={() => void copyPrompt()} disabled={!prompt}>
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
          {promptError && <div style={{ color: 'var(--red)', fontSize: fontSize.sm }}>{promptError}</div>}
          <textarea
            data-testid="cover-prompt"
            readOnly
            value={prompt}
            rows={7}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: '100%', resize: 'vertical', fontSize: fontSize.xs, lineHeight: 1.5,
              padding: spacing.md, borderRadius: radius.md, border: '1px solid var(--border)',
              background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Step 2: paste / drop / upload the image back */}
        <div style={{ display: 'grid', gap: spacing.sm }}>
          <strong style={{ fontSize: fontSize.sm }}>② 把生成的图粘贴 / 拖入 / 选择文件贴回来</strong>
          <div
            tabIndex={0}
            onPaste={(e) => {
              const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
              if (item) readImageFile(item.getAsFile())
            }}
            onDrop={(e) => { e.preventDefault(); readImageFile(e.dataTransfer.files?.[0]) }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            style={{
              border: '1px dashed var(--border)', borderRadius: radius.md, padding: spacing.lg,
              textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: fontSize.sm,
              background: 'var(--bg-tertiary)',
            }}
          >
            {imageData
              ? <img src={imageData} alt="封面预览" style={{ maxHeight: 220, maxWidth: '100%', borderRadius: radius.sm }} />
              : <span>点此选择图片，或 Ctrl/⌘+V 粘贴，或拖拽进来</span>}
          </div>
          <input
            ref={fileRef}
            data-testid="cover-file"
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => readImageFile(e.currentTarget.files?.[0])}
          />
        </div>

        {/* Optional: auto-generate (needs an image key) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>配了图像 key 也可以：</span>
          <Button size="sm" variant="secondary" onClick={() => void autoGenerate()} loading={autoBusy}>
            {autoBusy ? '生成中…' : '试试自动生成'}
          </Button>
        </div>

        {message && <div style={{ color: 'var(--green)', fontSize: fontSize.sm }}>{message}</div>}
        {error && <div style={{ color: 'var(--red)', fontSize: fontSize.sm }}>{error}</div>}
      </div>
    </Modal>
  )
}
