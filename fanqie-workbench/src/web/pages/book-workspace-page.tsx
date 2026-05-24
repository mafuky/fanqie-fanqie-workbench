import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChapterEditor } from '../components/chapter-editor.js'
import { ClaudeExecutionPanel } from '../components/claude-execution-panel.js'
import { spacing, fontSize, radius } from '../styles/tokens.js'

type ChapterRow = { id: string; chapter_number: number; title: string; stage: string }
type SessionRow = { id: string; status: string; bookId?: string | null; currentSkill: string | null; chapterId: string | null; pendingQuestionJson?: string | null }
type BookDetail = { book: { id: string; title: string; root_path: string }; chapters: ChapterRow[]; summary?: { activeSessionId?: string | null; activeChapterId?: string | null } }

export function BookWorkspacePage({ bookId, onBack }: { bookId: string; onBack?: () => void }) {
  const [detail, setDetail] = useState<BookDetail | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeActionLabel, setActiveActionLabel] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [editorReloadKey, setEditorReloadKey] = useState(0)

  const load = useCallback(async (refreshEditor = false) => {
    setLoading((current) => current || !detail)
    setError(null)
    try {
      const [bookResponse, sessionsResponse, publicationsResponse] = await Promise.all([
        fetch(`/api/books/${bookId}`),
        fetch(`/api/books/${bookId}/sessions`),
        fetch(`/api/books/${bookId}/publications`),
      ])
      const [nextDetail, sessionsBody, publicationsBody] = await Promise.all([
        bookResponse.json().catch(() => ({})),
        sessionsResponse.json().catch(() => ({})),
        publicationsResponse.json().catch(() => ({})),
      ])
      if (!bookResponse.ok) throw new Error(nextDetail.error || '加载书籍失败')
      if (!sessionsResponse.ok) throw new Error(sessionsBody.error || '加载会话失败')
      if (!publicationsResponse.ok) throw new Error(publicationsBody.error || '加载发布信息失败')

      setDetail(nextDetail)
      setSessions(sessionsBody.sessions || [])
      setSelectedChapterId((current) => current || nextDetail.summary?.activeChapterId || nextDetail.chapters?.[0]?.id || null)
      setActiveSessionId(nextDetail.summary?.activeSessionId || null)
      if (refreshEditor) setEditorReloadKey((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [bookId, detail])

  useEffect(() => {
    setDetail(null)
    setSessions([])
    setSelectedChapterId(null)
    setActiveSessionId(null)
    setActiveActionLabel('')
    setEditorReloadKey(0)
    setLoading(true)
    void load()
  }, [bookId])

  const selectedChapter = detail?.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null
  const activeSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) ?? null, [sessions, activeSessionId])

  const scanChapters = async () => {
    setScanning(true)
    setError(null)
    try {
      const response = await fetch('/api/books/scan', { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '扫描失败')
      await load(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '扫描失败')
    } finally {
      setScanning(false)
    }
  }

  const startAction = async (actionKey: string, label: string) => {
    if (!selectedChapterId) return
    setActionError(null)
    const response = await fetch('/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionKey, bookId, chapterId: selectedChapterId }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionError(body.error || '启动失败')
      return
    }
    setActiveSessionId(body.session.id)
    setActiveActionLabel(label)
    setSessions((current) => [{ ...body.session, bookId, chapterId: selectedChapterId, currentSkill: actionKey, pendingQuestionJson: null }, ...current.filter((session) => session.id !== body.session.id)])
  }

  const refreshAfterSessionChange = async () => {
    await load(true)
  }

  if (loading && !detail) return <div>正在加载书籍…</div>

  if (error && !detail) {
    return (
      <section style={{ display: 'grid', gap: spacing.md }}>
        {onBack && <button onClick={onBack} style={{ width: 'fit-content' }}>返回书库</button>}
        <div style={{ color: 'var(--red)' }}>{error}</div>
        <button onClick={() => void load()} style={{ width: 'fit-content' }}>重试</button>
      </section>
    )
  }

  if (!detail) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
        {onBack && <button onClick={onBack}>返回书库</button>}
        <div>
          <h1 style={{ margin: 0, fontSize: fontSize.xxl }}>{detail.book.title}</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: fontSize.sm }}>单书工作台</div>
        </div>
      </header>

      <nav style={{ display: 'flex', gap: spacing.sm, color: 'var(--text-muted)', fontSize: fontSize.sm }}>
        <span>Dashboard</span><span>写作</span><span>Claude 会话</span><span>创作流程</span><span>发布</span><span>资料 / 工具</span>
      </nav>

      {error && <div style={{ color: 'var(--red)' }}>{error}</div>}

      {detail.chapters.length === 0 ? (
        <section style={{ border: '1px dashed var(--border)', borderRadius: radius.lg, padding: spacing.lg, display: 'grid', gap: spacing.md, color: 'var(--text-muted)' }}>
          <div>未发现章节，请先扫描 novels/ 或确认 正文/*.md 文件存在</div>
          <button onClick={() => void scanChapters()} disabled={scanning} style={{ width: 'fit-content' }}>{scanning ? '扫描中…' : '扫描章节'}</button>
        </section>
      ) : (
        <main style={{ display: 'grid', gridTemplateColumns: '220px minmax(420px, 1fr) 360px', gap: spacing.lg, alignItems: 'start' }}>
          <aside style={{ border: '1px solid var(--border)', borderRadius: radius.lg, padding: spacing.md }}>
            <h2 style={{ fontSize: fontSize.md }}>章节</h2>
            {detail.chapters.map((chapter) => (
              <button key={chapter.id} onClick={() => setSelectedChapterId(chapter.id)} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: spacing.xs, padding: spacing.sm, borderRadius: radius.md, border: selectedChapterId === chapter.id ? '1px solid var(--accent)' : '1px solid transparent', background: selectedChapterId === chapter.id ? 'var(--accent-subtle)' : 'transparent', color: 'var(--text-primary)' }}>
                <div>{chapter.title}</div>
                <small style={{ color: 'var(--text-muted)' }}>第 {chapter.chapter_number} 章 · {chapter.stage}</small>
              </button>
            ))}
          </aside>

          <section>
            <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.md }}>
              <button onClick={() => void startAction('chapter.continue', '继续写本章')} disabled={!selectedChapter}>继续写本章</button>
              <button onClick={() => void startAction('chapter.deslop', '去 AI 味本章')} disabled={!selectedChapter}>去 AI 味本章</button>
              <button onClick={() => void startAction('chapter.review', '审稿本章')} disabled={!selectedChapter}>审稿本章</button>
            </div>
            {actionError && <div style={{ color: 'var(--red)', marginBottom: spacing.sm }}>{actionError}</div>}
            {selectedChapterId && <ChapterEditor key={selectedChapterId} chapterId={selectedChapterId} reloadKey={editorReloadKey} onSaved={() => void load()} />}
          </section>

          <ClaudeExecutionPanel
            sessionId={activeSessionId}
            sessionStatus={activeSession?.status ?? null}
            actionLabel={activeActionLabel || activeSession?.currentSkill || undefined}
            onDone={() => void refreshAfterSessionChange()}
            onInterrupted={() => void refreshAfterSessionChange()}
            onAnswerSubmitted={() => void refreshAfterSessionChange()}
          />
        </main>
      )}
    </div>
  )
}
