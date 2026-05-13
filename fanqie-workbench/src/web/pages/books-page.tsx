import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import type { ChapterStage } from '../../domain/chapter.js'
import { LiveLogPanel } from '../components/live-log-panel.js'
import { useTheme } from '../app.js'
import { PageHeader } from '../components/ui/page-header.js'
import { Card } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Input } from '../components/ui/input.js'
import { EmptyState } from '../components/ui/empty-state.js'
import { Spinner } from '../components/ui/spinner.js'
import { useToast } from '../components/ui/toast.js'
import { spacing, fontSize, fontWeight, radius, transition } from '../styles/tokens.js'

type BookWithChapters = {
  id: string
  title: string
  root_path: string
  account_id: string | null
  chapters: ChapterRow[]
}

type ChapterRow = {
  id: string
  chapter_number: number
  title: string
  stage: ChapterStage
}

const ALL_STAGES: ChapterStage[] = ['待写作', '已初稿', '已去AI', '已审稿', '可发布', '发布中', '已发布']

const stageBadgeVariant: Record<ChapterStage, 'neutral' | 'warning' | 'success' | 'error'> = {
  '待写作': 'neutral',
  '已初稿': 'warning',
  '已去AI': 'warning',
  '已审稿': 'neutral',
  '可发布': 'success',
  '发布中': 'error',
  '已发布': 'success',
}

const stageBadgeStyleByTheme: Record<'dark' | 'light', Record<ChapterStage, React.CSSProperties>> = {
  dark: {
    '待写作': {
      background: '#2b2620',
      color: '#d1b99c',
      border: '1px solid #433726',
    },
    '已初稿': {
      background: '#32281d',
      color: '#e1b27a',
      border: '1px solid #4b3722',
    },
    '已去AI': {
      background: '#3b281a',
      color: '#f0ab62',
      border: '1px solid #5b381e',
    },
    '已审稿': {
      background: '#2e2824',
      color: '#d6b8a0',
      border: '1px solid #44372f',
    },
    '可发布': {
      background: '#243027',
      color: '#b9d1ae',
      border: '1px solid #36483a',
    },
    '发布中': {
      background: '#382523',
      color: '#e0a29b',
      border: '1px solid #553330',
    },
    '已发布': {
      background: '#223026',
      color: '#b8d5b2',
      border: '1px solid #34473a',
    },
  },
  light: {
    '待写作': {
      background: '#efe4d3',
      color: '#7b6248',
      border: '1px solid #e2d0b8',
    },
    '已初稿': {
      background: '#f6ead7',
      color: '#946535',
      border: '1px solid #ebd2ad',
    },
    '已去AI': {
      background: '#f3dfc4',
      color: '#9a5b25',
      border: '1px solid #e8c79e',
    },
    '已审稿': {
      background: '#f1e7da',
      color: '#7e6652',
      border: '1px solid #e5d5c3',
    },
    '可发布': {
      background: '#e8efe1',
      color: '#5f7750',
      border: '1px solid #d3dfc7',
    },
    '发布中': {
      background: '#f4ddd7',
      color: '#965547',
      border: '1px solid #e7beb3',
    },
    '已发布': {
      background: '#e7efe3',
      color: '#557448',
      border: '1px solid #cfe0c6',
    },
  },
}

export function BooksPage() {
  const { theme } = useTheme()
  const [books, setBooks] = useState<BookWithChapters[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<ChapterStage | 'all'>('all')
  const [processingChapterId, setProcessingChapterId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<'running' | 'succeeded' | 'failed' | null>(null)
  const [userHint, setUserHint] = useState('')
  const toast = useToast()

  const loadBooks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/books')
      const data = await res.json()
      const booksRaw: Array<{ id: string; title: string; root_path: string; account_id: string | null }> = data.books || []

      const booksWithChapters = await Promise.all(
        booksRaw.map(async (book) => {
          const chRes = await fetch(`/api/books/${book.id}`)
          const chData = await chRes.json()
          return { ...book, chapters: (chData.chapters || []) as ChapterRow[] }
        })
      )
      setBooks(booksWithChapters)
    } catch {
      toast.error('加载书籍失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const reloadExpandedBook = useCallback(async () => {
    if (!expandedBookId) return
    try {
      const chRes = await fetch(`/api/books/${expandedBookId}`)
      const chData = await chRes.json()
      const chapters = (chData.chapters || []) as ChapterRow[]
      setBooks((prev) => prev.map((b) =>
        b.id === expandedBookId ? { ...b, chapters } : b
      ))
    } catch {}
  }, [expandedBookId])

  useEffect(() => { loadBooks() }, [loadBooks])

  useEffect(() => {
    const raw = localStorage.getItem('fanqie:books:active-session')
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as { sessionId: string; bookId: string; chapterId: string }
      fetch(`/api/sessions/${saved.sessionId}`).then((res) => res.json()).then((data) => {
        if (data.session && (data.session.status === 'running' || data.session.status === 'waiting-answer')) {
          setSessionId(saved.sessionId)
          setProcessingChapterId(saved.chapterId)
          setExpandedBookId(saved.bookId)
          setSessionStatus('running')
        }
      }).catch(() => {})
    } catch {}
  }, [])

  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/books/scan', { method: 'POST' })
      const data = await res.json()
      toast.success(`扫描完成：${data.bookCount} 本书，${data.chapterCount} 章`)
      await loadBooks()
    } catch {
      toast.error('扫描失败')
    } finally {
      setScanning(false)
    }
  }, [loadBooks, toast])

  const toggleBook = useCallback((bookId: string) => {
    setExpandedBookId((prev) => prev === bookId ? null : bookId)
    setStageFilter('all')
    setSessionId(null)
    setSessionStatus(null)
    setProcessingChapterId(null)
  }, [])

  const handleProcess = useCallback(async (chapterId: string) => {
    setProcessingChapterId(chapterId)
    setSessionId(null)
    setSessionStatus('running')

    const currentBookId = expandedBookId
    if (!currentBookId) return

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'chapter',
          bookId: currentBookId,
          chapterId,
          currentSkill: 'chapter-pipeline',
        }),
      })
      const data = await res.json()
      setSessionId(data.session.id)
      localStorage.setItem('fanqie:books:active-session', JSON.stringify({ sessionId: data.session.id, bookId: currentBookId, chapterId }))
    } catch {
      toast.error('处理请求失败')
      setProcessingChapterId(null)
      setSessionStatus(null)
    }
  }, [expandedBookId, toast])

  const handleTaskDone = useCallback(async (status: string) => {
    const success = status === 'succeeded'
    setSessionStatus(success ? 'succeeded' : 'failed')
    localStorage.removeItem('fanqie:books:active-session')
    setProcessingChapterId(null)
    if (success) {
      toast.success('章节处理完成')
    } else {
      toast.error('章节处理失败')
    }
    await reloadExpandedBook()
  }, [toast, reloadExpandedBook])

  const totalChapters = books.reduce((sum, b) => sum + b.chapters.length, 0)
  const publishedChapters = books.reduce((sum, b) => sum + b.chapters.filter((c) => c.stage === '已发布').length, 0)
  const pendingChapters = totalChapters - publishedChapters

  const stats = [
    { label: '总书籍', value: books.length, color: 'var(--text-primary)' },
    { label: '总章节', value: totalChapters, color: 'var(--text-primary)' },
    { label: '已发布', value: publishedChapters, color: 'var(--green)' },
    { label: '待处理', value: pendingChapters, color: 'var(--accent)' },
  ]

  if (loading) {
    return (
      <div>
        <PageHeader title="书籍管理" description="管理工作区内的小说项目" />
        <div style={{ display: 'flex', justifyContent: 'center', padding: spacing['4xl'] }}>
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="书籍管理"
        description="管理工作区内的小说项目"
        actions={
          <>
            <Button variant="secondary" onClick={loadBooks}>刷新</Button>
            <Button onClick={handleScan} loading={scanning}>扫描 novels/ 目录</Button>
          </>
        }
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.lg, marginBottom: spacing.xl }}>
        {stats.map((s) => (
          <div key={s.label} style={{
            padding: `${spacing.sm}px ${spacing.lg}px`,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: radius.md,
            fontSize: fontSize.sm,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
            <span style={{ color: s.color, fontWeight: fontWeight.semibold, marginLeft: spacing.sm - 2 }}>{s.value}</span>
          </div>
        ))}
      </div>

      {books.length === 0 ? (
        <Card>
          <EmptyState
            icon="◉"
            title="暂无书籍"
            description="点击「扫描 novels/ 目录」导入工作区中的小说"
            action={{ label: '扫描 novels/ 目录', onClick: handleScan }}
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {books.map((book) => {
            const expanded = expandedBookId === book.id
            const bookPublished = book.chapters.filter((c) => c.stage === '已发布').length
            const bookPending = book.chapters.length - bookPublished
            const filteredChapters = stageFilter === 'all'
              ? book.chapters
              : book.chapters.filter((c) => c.stage === stageFilter)

            const stageCounts = ALL_STAGES.map((stage) => ({
              stage,
              count: book.chapters.filter((c) => c.stage === stage).length,
            }))

            return (
              <Card key={book.id} padding={0}>
                {/* Book header */}
                <div
                  onClick={() => toggleBook(book.id)}
                  style={{
                    padding: `${spacing.lg}px ${spacing.xl}px`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
                    <span style={{
                      color: expanded ? 'var(--accent)' : 'var(--text-muted)',
                      fontSize: fontSize.lg + 1,
                      transition: `transform ${transition.normal}`,
                      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      display: 'inline-block',
                    }}>▸</span>
                    <div>
                      <div style={{ fontWeight: fontWeight.semibold, fontSize: fontSize.lg - 1 }}>
                        {book.title}
                      </div>
                      <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)', marginTop: 2 }}>
                        {book.root_path} · {book.chapters.length} 章 · 已发布 {bookPublished}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: spacing.sm - 2 }}>
                    {bookPublished > 0 && <Badge variant="success">{bookPublished} 已发布</Badge>}
                    {bookPending > 0 && <Badge variant="warning">{bookPending} 待处理</Badge>}
                  </div>
                </div>

                {/* Expanded content */}
                {expanded && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {/* User hint input */}
                    <div style={{ padding: `${spacing.md}px ${spacing.xl}px`, borderBottom: '1px solid var(--border)' }}>
                      <Input
                        value={userHint}
                        onChange={(e) => setUserHint(e.currentTarget.value)}
                        placeholder="写作方向（可选）：例如 这章要写主角发现关键线索，节奏加快"
                      />
                    </div>

                    {/* Stage filter tabs */}
                    <div style={{
                      display: 'flex',
                      padding: `${spacing.lg - 2}px ${spacing.xl}px ${spacing.md}px`,
                      gap: spacing.sm,
                      borderBottom: '1px solid var(--border)',
                      overflowX: 'auto',
                      background: 'linear-gradient(180deg, rgba(255,253,248,0.06), transparent)',
                    }}>
                      <FilterTab
                        active={stageFilter === 'all'}
                        onClick={() => setStageFilter('all')}
                        label={`全部 (${book.chapters.length})`}
                      />
                      {stageCounts.map(({ stage, count }) => (
                        <FilterTab
                          key={stage}
                          active={stageFilter === stage}
                          onClick={() => setStageFilter(stage)}
                          label={`${stage} (${count})`}
                        />
                      ))}
                    </div>

                    {/* Chapter rows */}
                    {filteredChapters.length === 0 ? (
                      <div style={{
                        margin: `${spacing.sm}px ${spacing.xl}px ${spacing.lg}px`,
                        padding: `${spacing['2xl']}px ${spacing.xl}px`,
                        textAlign: 'center',
                        background: theme === 'light'
                          ? 'linear-gradient(180deg, #fffdf8, #f7efe4)'
                          : 'linear-gradient(180deg, #1f1a17, #171311)',
                        border: theme === 'light' ? '1px dashed #e8d9c6' : '1px dashed #4a3a2f',
                        borderRadius: 14,
                      }}>
                        <p style={{ color: theme === 'light' ? '#8b7461' : '#c9b19a', fontSize: fontSize.md }}>
                          该筛选条件下暂无章节
                        </p>
                      </div>
                    ) : (
                      filteredChapters.map((ch) => {
                        const isReady = ch.stage === '可发布' || ch.stage === '已发布'
                        const isProcessing = processingChapterId === ch.id
                        const isOtherProcessing = !!processingChapterId && !isProcessing

                        return (
                          <div
                            key={ch.id}
                            className="chapter-row"
                            style={{
                              margin: `${spacing.sm}px ${spacing.xl}px`,
                              padding: `${spacing.md}px ${spacing.lg}px`,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              border: theme === 'light'
                                ? (isProcessing ? '1px solid #e7c497' : '1px solid #eadfcf')
                                : (isProcessing ? '1px solid #6a4c2e' : '1px solid #3f3127'),
                              borderRadius: 14,
                              fontSize: fontSize.md,
                              background: theme === 'light'
                                ? (isProcessing
                                  ? 'linear-gradient(180deg, #fffaf2, #f6eadb)'
                                  : 'linear-gradient(180deg, #fffdf8, #f8f0e5)')
                                : (isProcessing
                                  ? 'linear-gradient(180deg, #2b211b, #211915)'
                                  : 'linear-gradient(180deg, #1e1815, #171210)'),
                              boxShadow: theme === 'light'
                                ? (isProcessing
                                  ? '0 8px 24px rgba(161, 111, 43, 0.10)'
                                  : '0 4px 14px rgba(120, 80, 30, 0.06)')
                                : (isProcessing
                                  ? '0 8px 24px rgba(0, 0, 0, 0.28)'
                                  : '0 4px 14px rgba(0, 0, 0, 0.18)'),
                              transition: `all ${transition.normal}`,
                              cursor: 'default',
                              transform: isProcessing ? 'translateY(-1px)' : 'none',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.md }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '4px 10px',
                                  borderRadius: 999,
                                  background: theme === 'light'
                                    ? (isProcessing ? '#f0ddc3' : '#f4e6d2')
                                    : (isProcessing ? '#4a3423' : '#38291d'),
                                  color: theme === 'light'
                                    ? (isProcessing ? '#9a5b25' : '#9a6a2e')
                                    : (isProcessing ? '#f0bc82' : '#e1b37c'),
                                  fontSize: fontSize.xs,
                                  fontWeight: fontWeight.bold,
                                  whiteSpace: 'nowrap',
                                  marginTop: 1,
                                }}
                              >
                                第{ch.chapter_number}章
                              </span>
                              <div>
                                <div style={{
                                  fontSize: fontSize.md + 1,
                                  fontWeight: fontWeight.semibold,
                                  color: theme === 'light' ? '#4b3b2f' : '#f1e1d2',
                                  lineHeight: 1.4,
                                }}>
                                  {ch.title}
                                </div>
                                <div style={{
                                  fontSize: fontSize.xs,
                                  color: theme === 'light' ? '#8b7461' : '#c7ae97',
                                  marginTop: 4,
                                  lineHeight: 1.5,
                                }}>
                                  {isProcessing
                                    ? '正在处理这一章，像被摊开的稿纸'
                                    : isReady
                                      ? '当前章节已进入可发布状态'
                                      : '继续推进这一章的写作流程'}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '4px 10px',
                                  borderRadius: 999,
                                  fontSize: fontSize.xs,
                                  fontWeight: fontWeight.medium,
                                  ...stageBadgeStyleByTheme[theme][ch.stage],
                                }}
                              >
                                {ch.stage}
                              </span>
                              {isReady ? (
                                <span style={{ fontSize: fontSize.xs, color: theme === 'light' ? '#6e8b5e' : '#b8d5b2', fontWeight: fontWeight.semibold }}>✓</span>
                              ) : isProcessing ? (
                                <span style={{ fontSize: fontSize.xs, color: theme === 'light' ? '#9a5b25' : '#f0bc82', fontWeight: fontWeight.semibold }}>处理中...</span>
                              ) : isOtherProcessing ? (
                                <span style={{
                                  fontSize: fontSize.xs,
                                  color: theme === 'light' ? '#a28d78' : '#b79e87',
                                  background: theme === 'light' ? '#f3ebdf' : '#2a221d',
                                  border: theme === 'light' ? '1px solid #e7d9c7' : '1px solid #43362d',
                                  padding: '4px 10px',
                                  borderRadius: 999,
                                }}>
                                  等待
                                </span>
                              ) : (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleProcess(ch.id)}
                                >
                                  处理
                                </Button>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}

                    {/* Pipeline log */}
                    {sessionId && (
                      <div style={{ padding: `${spacing.lg}px ${spacing.xl}px`, borderTop: '1px solid var(--border)' }}>
                        {sessionStatus && sessionStatus !== 'running' && (
                          <div style={{ marginBottom: spacing.md, display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                            {sessionStatus === 'succeeded' && <Badge variant="success">✓ 处理完成</Badge>}
                            {sessionStatus === 'failed' && <Badge variant="error">✕ 处理失败</Badge>}
                          </div>
                        )}
                        <LiveLogPanel taskId={sessionId} streamBase="sessions" onDone={handleTaskDone} />
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: `${spacing.xs}px ${spacing.md - 2}px`,
        background: active ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        border: 'none',
        borderRadius: radius.sm,
        fontSize: fontSize.xs,
        fontWeight: active ? fontWeight.medium : fontWeight.normal,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: `all ${transition.fast}`,
      }}
    >
      {label}
    </button>
  )
}
