import { useState, useCallback, useEffect } from 'react'
import { LiveLogPanel } from '../components/live-log-panel.js'
import { PageHeader } from '../components/ui/page-header.js'
import { Card } from '../components/ui/card.js'
import { Textarea } from '../components/ui/input.js'
import { Button } from '../components/ui/button.js'
import { Badge } from '../components/ui/badge.js'
import { useToast } from '../components/ui/toast.js'
import { spacing, fontSize, fontWeight, transition } from '../styles/tokens.js'

type SessionRecord = {
  id: string
  kind: string
  status: string
  currentSkill: string | null
  pendingQuestionJson: string | null
  createdAt: string
  updatedAt: string
}

const SKILLS = [
  { id: 'custom', name: '自定义 Prompt', desc: '直接输入完整提示词' },
  { id: 'chinese-novelist', name: '章节写作', desc: '使用 chinese-novelist-skill 写章节' },
  { id: 'story-deslop', name: '去AI味', desc: '检测并清除AI写作痕迹' },
  { id: 'story-review', name: '多视角审稿', desc: '4个Agent并行审查找问题' },
  { id: 'story-long-write', name: '长篇写作', desc: '从大纲到正文辅助长篇创作' },
  { id: 'story-long-analyze', name: '长篇拆文', desc: '拆解爆款长篇的结构技巧' },
  { id: 'story-short-write', name: '短篇写作', desc: '短篇小说从构思到成稿' },
  { id: 'story-cover', name: '封面生成', desc: '自动生成网文封面' },
  { id: 'story-import', name: '导入小说', desc: '将已有小说导入标准目录结构' },
  { id: 'story', name: '工具箱入口', desc: '自动路由到对应skill' },
]

function buildPrompt(skillId: string, userInput: string): string {
  if (skillId === 'custom') return userInput
  return `使用 ${skillId} skill 执行以下任务：\n\n${userInput}`
}

const statusMap: Record<string, { variant: 'success' | 'error' | 'warning' | 'neutral'; label: string }> = {
  succeeded: { variant: 'success', label: '成功' },
  failed: { variant: 'error', label: '失败' },
  running: { variant: 'warning', label: '执行中' },
  queued: { variant: 'neutral', label: '排队中' },
}

export function PromptPage() {
  const [skill, setSkill] = useState('custom')
  const [prompt, setPrompt] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'succeeded' | 'failed'>('idle')
  const [history, setHistory] = useState<SessionRecord[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const toast = useToast()

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions?kind=prompt')
      const data = await res.json()
      setHistory((data.sessions || []).filter((session: SessionRecord) => session.currentSkill !== 'book-entry'))
    } catch {}
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  useEffect(() => {
    let mounted = true
    const saved = localStorage.getItem('fanqie:prompt:active-session')
    if (!saved) return () => { mounted = false }
    fetch(`/api/sessions/${saved}`).then((res) => res.json()).then((data) => {
      if (!mounted) return
      if (data.session && (data.session.status === 'running' || data.session.status === 'waiting-answer')) {
        setSessionId(data.session.id)
        setStatus('running')
      }
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || status === 'running') return
    setStatus('running')
    setSessionId(null)
    const fullPrompt = buildPrompt(skill, prompt.trim())
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'prompt', currentSkill: skill, prompt: fullPrompt }),
      })
      const data = await res.json()
      setSessionId(data.session.id)
      localStorage.setItem('fanqie:prompt:active-session', data.session.id)
    } catch {
      setStatus('failed')
      toast.error('任务提交失败')
    }
  }, [prompt, status, skill, toast])

  const handleDone = useCallback((finalStatus: string) => {
    const success = finalStatus === 'succeeded'
    setStatus(success ? 'succeeded' : 'failed')
    localStorage.removeItem('fanqie:prompt:active-session')
    if (success) toast.success('任务执行成功')
    else toast.error('任务执行失败')
    loadHistory()
  }, [loadHistory, toast])

  const handleViewTask = useCallback((id: string) => {
    setSessionId(id)
    setStatus('idle')
  }, [])

  const handleClearHistory = useCallback(async () => {
    setHistory([])
    setSessionId(null)
    localStorage.removeItem('fanqie:prompt:active-session')
    toast.info('历史已清除')
  }, [toast])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) handleSubmit()
  }, [handleSubmit])

  const selectedSkill = SKILLS.find((s) => s.id === skill)

  return (
    <div>
      <PageHeader
        title="自由会话"
        description="用于临时试验、开书构思或排查会话问题；主工作流请优先在书籍页推进。"
      />

      {/* Skill selector */}
      <Card style={{ marginBottom: spacing.lg }}>
        <label style={{
          display: 'block', fontSize: fontSize.sm, fontWeight: fontWeight.semibold,
          color: 'var(--text-secondary)', textTransform: 'uppercase',
          letterSpacing: '0.05em', marginBottom: spacing.md - 2,
        }}>
          调试 / 高级使用
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
          {SKILLS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSkill(s.id)}
              title={s.desc}
              style={{
                padding: `${spacing.sm - 2}px ${spacing.lg - 2}px`,
                background: skill === s.id ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                color: skill === s.id ? 'var(--accent)' : 'var(--text-secondary)',
                border: skill === s.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 20, cursor: 'pointer',
                fontSize: fontSize.sm, fontWeight: skill === s.id ? fontWeight.semibold : fontWeight.normal,
                fontFamily: 'inherit', transition: `all ${transition.fast}`,
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        <p style={{ fontSize: fontSize.xs, color: 'var(--text-muted)', marginTop: spacing.sm }}>
          这里保留给临时调试和自由协作，不是整本书的主入口。
        </p>
        {selectedSkill && selectedSkill.id !== 'custom' && (
          <p style={{ fontSize: fontSize.sm, color: 'var(--text-muted)', marginTop: spacing.sm }}>
            {selectedSkill.desc}
          </p>
        )}
      </Card>

      {/* Prompt input */}
      <Card style={{ marginBottom: spacing['2xl'] }}>
        <Textarea
          label={skill === 'custom' ? '提示词' : '任务指令'}
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={skill === 'custom'
            ? '输入完整提示词...'
            : `输入你要 ${selectedSkill?.name} 做什么，例如：为《雾港疑局》写第5章，悬疑节奏紧凑，不少于3000字`
          }
          rows={4}
        />
        <div style={{ marginTop: spacing.lg - 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
            <Button
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              loading={status === 'running'}
            >
              {status === 'running' ? '执行中...' : '▶ 执行'}
            </Button>
            {status === 'succeeded' && <Badge variant="success">✓ 成功</Badge>}
            {status === 'failed' && <Badge variant="error">✕ 失败</Badge>}
          </div>
          <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>
            {typeof navigator !== 'undefined' && /Win/.test(navigator.platform) ? 'Ctrl' : '⌘'}+Enter
          </span>
        </div>
      </Card>

      {/* Live log */}
      {sessionId && (
        <div style={{ marginBottom: spacing['2xl'] }}>
          <LiveLogPanel taskId={sessionId} streamBase="sessions" onDone={handleDone} />
        </div>
      )}

      {/* Task history */}
      {history.length > 0 && (
        <div>
          <div
            onClick={() => setHistoryOpen((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', marginBottom: historyOpen ? spacing.md - 2 : 0, userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <span style={{
                fontSize: fontSize.sm, color: 'var(--text-muted)',
                transition: `transform ${transition.normal}`,
                transform: historyOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              }}>▶</span>
              <h3 style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: 'var(--text-secondary)' }}>
                历史任务 ({history.length})
              </h3>
            </div>
            {historyOpen && (
              <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); handleClearHistory() }}>
                清除全部
              </Button>
            )}
          </div>
          {historyOpen && (
            <Card padding={0} style={{ overflow: 'hidden' }}>
              {history.slice(0, 20).map((session) => {
                const sm = statusMap[session.status] || statusMap.queued
                return (
                  <div
                    key={session.id}
                    className="history-row"
                    onClick={() => handleViewTask(session.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: `${spacing.md - 2}px ${spacing.lg}px`,
                      borderBottom: '1px solid var(--border)', cursor: 'pointer',
                      background: sessionId === session.id ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: fontSize.md, color: 'var(--text-primary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 400,
                      }}>
                        {(session.currentSkill && session.currentSkill !== 'custom') ? `Skill: ${session.currentSkill}` : '自由对话会话'}
                      </div>
                      <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)', marginTop: 2 }}>
                        {new Date(session.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <Badge variant={sm.variant}>{sm.label}</Badge>
                  </div>
                )
              })}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
