import { useState, useEffect, useCallback } from 'react'
import type { ChapterStage } from '../../domain/chapter.js'
import { LiveLogPanel } from '../components/live-log-panel.js'
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

const stageBadgeVariant: Record<ChapterStage, 'neutral' | 'info' | 'warning' | 'success' | 'error'> = {
  '待写作': 'neutral',
  '已初稿': 'info',
  '已去AI': 'warning',
  '已审稿': 'info',
  '可发布': 'success',
  '发布中': 'error',
  '已发布': 'success',
}

export function BooksPage() {
  const [books, setBooks] = useState<BookWithChapters[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<ChapterStage | 'all'>('all')
  const [processingChapterId, setProcessingChapterId] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<'running' | 'succeeded' | 'failed' | null>(null)
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
    setTaskId(null)
    setTaskStatus(null)
    setProcessingChapterId(null)
  }, [])

  const handleProcess = useCallback(async (chapterId: string) => {
    setProcessingChapterId(chapterId)
    setTaskId(null)
    setTaskStatus('running')

    try {
      const res = await fetch(`/api/chapters/${chapterId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetStage: '可发布',
          userHint: userHint.trim() || undefined,
        }),
      })
      const data = await res.json()
      setTaskId(data.taskId)
    } catch {
      toast.error('处理请求失败')
      setProcessingChapterId(null)
      setTaskStatus(null)
    }
  }, [userHint, toast])

  const handleTaskDone = useCallback(async (status: string) => {
    const success = status === 'succeeded'
    setTaskStatus(success ? 'succeeded' : 'failed')
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
                      padding: `${spacing.md}px ${spacing.xl}px`,
                      gap: spacing.sm,
                      borderBottom: '1px solid var(--border)',
                      overflowX: 'auto',
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
                      <div style={{ padding: `${spacing['2xl']}px ${spacing.xl}px`, textAlign: 'center' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: fontSize.md }}>
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
                              padding: `${spacing.sm}px ${spacing.xl}px ${spacing.sm}px ${spacing['4xl'] + spacing.xs}px`,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              borderBottom: '1px solid var(--border)',
                              fontSize: fontSize.md,
                              background: isProcessing ? 'var(--accent-subtle)' : 'transparent',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md - 2 }}>
                              <span style={{ color: 'var(--text-muted)', fontSize: fontSize.xs, width: 24 }}>
                                {String(ch.chapter_number).padStart(2, '0')}
                              </span>
                              <span>{ch.title}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                              <Badge variant={stageBadgeVariant[ch.stage]}>{ch.stage}</Badge>
                              {isReady ? (
                                <span style={{ fontSize: fontSize.xs, color: 'var(--green)' }}>✓</span>
                              ) : isProcessing ? (
                                <span style={{ fontSize: fontSize.xs, color: 'var(--accent)' }}>处理中...</span>
                              ) : isOtherProcessing ? (
                                <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>等待</span>
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
                    {taskId && (
                      <div style={{ padding: `${spacing.lg}px ${spacing.xl}px`, borderTop: '1px solid var(--border)' }}>
                        {taskStatus && taskStatus !== 'running' && (
                          <div style={{ marginBottom: spacing.md, display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                            {taskStatus === 'succeeded' && <Badge variant="success">✓ 处理完成</Badge>}
                            {taskStatus === 'failed' && <Badge variant="error">✕ 处理失败</Badge>}
                          </div>
                        )}
                        <LiveLogPanel taskId={taskId} onDone={handleTaskDone} />
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
