import { useState, useEffect } from 'react'
import { Modal } from './ui/modal.js'
import { Textarea } from './ui/input.js'
import { Button } from './ui/button.js'
import { AgentPanel } from './agent-panel.js'
import { fontSize, spacing } from '../styles/tokens.js'

const COMMON_TEMPLATES = [
  '现代悬疑复仇文，强反转',
  '女频豪门追妻火葬场，带悬疑线',
  '男频诡异修仙，前期压抑后期爆发',
  '都市刑侦悬疑，双强对抗，节奏快',
  '古言权谋复仇，女主黑化成长',
  '无限流规则怪谈，强钩子高压感',
]

export function BookCreationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (bookId: string) => void
}) {
  const [idea, setIdea] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [bookId, setBookId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setIdea('')
      setSessionId(null)
      setBookId(null)
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  async function submit() {
    if (!idea.trim()) return
    setError(null)
    setSubmitting(true)
    try {
      const r = await fetch('/api/agent-sessions/book-create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: idea.trim() }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(body.error ?? '创建失败')
        return
      }
      setSessionId(body.sessionId)
      setBookId(body.bookId)
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  if (sessionId) {
    return (
      <Modal open={open} onClose={onClose} title={`正在创建《${idea.trim()}》`} footer={<Button variant="ghost" onClick={onClose}>关闭</Button>}>
        <div style={{ minWidth: 480 }}>
          <AgentPanel
            sessionId={sessionId}
            onDone={(status) => {
              if (status === 'succeeded' && bookId) onCreated?.(bookId)
            }}
          />
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建一本书"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            onClick={() => void submit()}
            disabled={!idea.trim()}
            loading={submitting}
            data-testid="book-create-submit"
          >
            {submitting ? '创建中...' : '开始生成'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Textarea
          label="开书想法"
          value={idea}
          onChange={(e) => setIdea(e.currentTarget.value)}
          placeholder="例如：现代悬疑复仇文，强反转"
          rows={4}
          data-testid="book-title-input"
        />

        {error && (
          <div style={{ color: 'var(--red)', fontSize: fontSize.sm, padding: `${spacing.sm}px 0` }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>常用模板</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {COMMON_TEMPLATES.map((template) => (
              <Button key={template} variant="secondary" size="sm" onClick={() => setIdea(template)}>
                {template}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
