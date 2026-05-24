import { useState, useEffect, useCallback, useRef } from 'react'
import type React from 'react'
import type { ChapterStage } from '../../domain/chapter.js'
import { getPlatformLabel, type KnownPlatform } from '../../domain/platform.js'
import { LiveLogPanel } from '../components/live-log-panel.js'
import { ReviewCheckpointCard } from '../components/review-checkpoint-card.js'
import { useTheme } from '../app.js'
import { PageHeader } from '../components/ui/page-header.js'
import { Card } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Input } from '../components/ui/input.js'
import { EmptyState } from '../components/ui/empty-state.js'
import { Spinner } from '../components/ui/spinner.js'
import { useToast } from '../components/ui/toast.js'
import { BookCreationModal } from '../components/book-creation-modal.js'
import { BookSessionPanel } from '../components/book-session-panel.js'
import { ChapterActionMenu, type ChapterActionKey } from '../components/chapter-action-menu.js'
import { ChapterReader } from '../components/chapter-reader.js'
import { spacing, fontSize, fontWeight, radius, transition } from '../styles/tokens.js'

type BookSummary = {
  totalChapters: number
  byStage: Record<ChapterStage, number>
  publishableCount: number
  activeSessionId: string | null
  activeChapterId: string | null
}

type PublicationSummary = {
  id: string
  bookId: string
  platform: string
  platformAccountId: string
  platformBookId: string | null
  status: 'draft' | 'bound' | 'paused'
  createdAt: string
  updatedAt: string
  account: {
    id: string
    label: string
    status: string
  }
  chapterStatusCounts: {
    pending: number
    synced: number
    published: number
    failed: number
  }
  latestPublishedAt: string | null
  canPublish: boolean
}

type PlatformAccountOption = {
  id: string
  platform: string
  label: string
  status: string
  lastCheckedAt: string | null
  createdAt: string
}

type BookWithChapters = {
  id: string
  title: string
  root_path: string
  account_id: string | null
  chapters: ChapterRow[]
  publications: PublicationSummary[]
  summary?: BookSummary
}

type ChapterRow = {
  id: string
  chapter_number: number
  title: string
  stage: ChapterStage
}

type BookSessionRecord = {
  id: string
  kind: string
  bookId: string | null
  chapterId: string | null
  status: string
  currentSkill: string | null
  pendingQuestionJson: string | null
  compressedAt?: string | null
  createdAt: string
  updatedAt: string
}

type BookEntryProgressStep = '生成书名' | '生成简介' | '生成大纲' | '生成章节目录' | '创建书籍' | '进入工作台'

const ALL_STAGES: ChapterStage[] = ['待写作', '已初稿', '已去AI', '已审稿', '可发布', '发布中', '已发布']
const EMPTY_SUMMARY: BookSummary = {
  totalChapters: 0,
  byStage: {
    '待写作': 0,
    '已初稿': 0,
    '已去AI': 0,
    '已审稿': 0,
    '可发布': 0,
    '发布中': 0,
    '已发布': 0,
  },
  publishableCount: 0,
  activeSessionId: null,
  activeChapterId: null,
}

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

const PUBLICATION_PLATFORMS: KnownPlatform[] = ['fanqie', 'qimao', 'qidian']

const NEXT_STAGE: Partial<Record<ChapterStage, ChapterStage>> = {
  '待写作': '已初稿',
  '已初稿': '已去AI',
  '已去AI': '已审稿',
  '已审稿': '可发布',
}

const accountStatusBadge: Record<string, { variant: 'success' | 'error' | 'warning'; label: string }> = {
  active: { variant: 'success', label: '账号可用' },
  expired: { variant: 'error', label: '账号过期' },
  'needs-login': { variant: 'warning', label: '账号待登录' },
}

const publicationStatusLabel: Record<PublicationSummary['status'], string> = {
  draft: '草稿',
  bound: '已绑定',
  paused: '已暂停',
}

const BOOK_ENTRY_STEPS: BookEntryProgressStep[] = ['生成书名', '生成简介', '生成大纲', '生成章节目录', '创建书籍', '进入工作台']

function parseBookEntrySections(lines: Array<{ stream: string; text: string }>) {
  const text = lines.filter((line) => line.stream === 'stdout').map((line) => line.text).join('')
  const starts = Array.from(text.matchAll(/(?:^|\n)书名[:：]/g))
  const finalText = starts.length > 0 ? text.slice(starts[starts.length - 1].index ?? 0) : text
  const title = finalText.match(/书名[:：]\s*([^\n]+)/)?.[1]?.trim() || ''
  const summary = finalText.match(/简介[:：]\s*([\s\S]*?)(?=\n\s*大纲[:：]|\n\s*章节目录[:：]|$)/)?.[1]?.trim() || ''
  const outline = finalText.match(/大纲[:：]\s*([\s\S]*?)(?=\n\s*章节目录[:：]|$)/)?.[1]?.trim() || ''
  const chapterCatalog = finalText.match(/章节目录[:：]?\s*([\s\S]+)/)?.[1]?.trim() || ''
  return { title, summary, outline, chapterCatalog }
}

export function BooksPage() {
  const { theme } = useTheme()
  const stageBadgeStyle = stageBadgeStyleByTheme[theme]
  const [books, setBooks] = useState<BookWithChapters[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [expandedBookId, setExpandedBookId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('fanqie:books:selected-book')
  })
  const [stageFilter, setStageFilter] = useState<ChapterStage | 'all'>('all')
  const [processingChapterId, setProcessingChapterId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<'running' | 'waiting-review' | 'succeeded' | 'failed' | null>(null)
  const [pendingBookEntrySessionId, setPendingBookEntrySessionId] = useState<string | null>(null)
  const [bookCreationOpen, setBookCreationOpen] = useState(false)
  const [bookCreationLoading, setBookCreationLoading] = useState(false)
  const [initializingStorySetup, setInitializingStorySetup] = useState(false)
  const [bookEntryStepIndex, setBookEntryStepIndex] = useState<number | null>(null)
  const [bookEntryContent, setBookEntryContent] = useState('')
  const [activeActionLabel, setActiveActionLabel] = useState<string | null>(null)
  const [openActionChapterId, setOpenActionChapterId] = useState<string | null>(null)
  const [readingChapterId, setReadingChapterId] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [bookSessions, setBookSessions] = useState<Record<string, BookSessionRecord[]>>({})
  const [userHint, setUserHint] = useState('')
  const [publishingPublicationId, setPublishingPublicationId] = useState<string | null>(null)
  const [verifyingPublicationId, setVerifyingPublicationId] = useState<string | null>(null)
  const [publicationPlatform, setPublicationPlatform] = useState<KnownPlatform>('fanqie')
  const [platformAccounts, setPlatformAccounts] = useState<Record<string, PlatformAccountOption[]>>({})
  const [selectedPlatformAccountId, setSelectedPlatformAccountId] = useState('')
  const [creatingPublication, setCreatingPublication] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null)
  const completedSessionIdsRef = useRef<Set<string>>(new Set())
  const toast = useToast()

  const loadBooks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/books')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '加载书籍失败')
      const booksRaw: Array<{ id: string; title: string; root_path: string; account_id: string | null }> = data.books || []

      const booksWithChapters = await Promise.all(
        booksRaw.map(async (book) => {
          const [chRes, sessionsRes, publicationsRes] = await Promise.all([
            fetch(`/api/books/${book.id}`),
            fetch(`/api/books/${book.id}/sessions`),
            fetch(`/api/books/${book.id}/publications`),
          ])
          const chData = await chRes.json().catch(() => ({}))
          const sessionsData = await sessionsRes.json().catch(() => ({}))
          const publicationsData = await publicationsRes.json().catch(() => ({}))
          if (!chRes.ok) throw new Error(chData.error || '加载书籍失败')
          if (!sessionsRes.ok) throw new Error(sessionsData.error || '加载书籍失败')
          if (!publicationsRes.ok) throw new Error(publicationsData.error || '加载发布平台失败')
          return {
            book: {
              ...book,
              chapters: (chData.chapters || []) as ChapterRow[],
              publications: (publicationsData.publications || []) as PublicationSummary[],
              summary: chData.summary as BookSummary | undefined,
            },
            sessions: (sessionsData.sessions || []) as BookSessionRecord[],
          }
        })
      )
      const nextBooks = booksWithChapters.map((entry) => entry.book)
      setBooks(nextBooks)
      setBookSessions(Object.fromEntries(booksWithChapters.map((entry) => [entry.book.id, entry.sessions])))
      setExpandedBookId((current) => current && !nextBooks.some((book) => book.id === current) ? null : current)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载书籍失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const reloadExpandedBook = useCallback(async () => {
    if (!expandedBookId) return
    try {
      const [chRes, sessionsRes, publicationsRes] = await Promise.all([
        fetch(`/api/books/${expandedBookId}`),
        fetch(`/api/books/${expandedBookId}/sessions`),
        fetch(`/api/books/${expandedBookId}/publications`),
      ])
      const chData = await chRes.json().catch(() => ({}))
      const sessionsData = await sessionsRes.json().catch(() => ({}))
      const publicationsData = await publicationsRes.json().catch(() => ({}))
      if (!chRes.ok) throw new Error(chData.error || '刷新书籍失败')
      if (!sessionsRes.ok) throw new Error(sessionsData.error || '刷新书籍失败')
      if (!publicationsRes.ok) throw new Error(publicationsData.error || '刷新发布平台失败')
      const chapters = (chData.chapters || []) as ChapterRow[]
      setBooks((prev) => prev.map((b) =>
        b.id === expandedBookId ? { ...b, chapters, publications: (publicationsData.publications || []) as PublicationSummary[], summary: chData.summary as BookSummary | undefined } : b
      ))
      setBookSessions((prev) => ({
        ...prev,
        [expandedBookId]: (sessionsData.sessions || []) as BookSessionRecord[],
      }))
    } catch {}
  }, [expandedBookId])

  useEffect(() => { loadBooks() }, [loadBooks])

  useEffect(() => {
    const savedBookEntrySessionId = localStorage.getItem('fanqie:books:book-entry-session')
    if (savedBookEntrySessionId) {
      fetch(`/api/sessions/${savedBookEntrySessionId}`).then((res) => res.json()).then((data) => {
        if (data.session && (data.session.status === 'running' || data.session.status === 'waiting-answer' || data.session.status === 'waiting-permission')) {
          setSessionId(savedBookEntrySessionId)
          setPendingBookEntrySessionId(savedBookEntrySessionId)
          setActiveActionLabel('新建一本书')
          setSessionStatus('running')
          setBookEntryStepIndex(0)
          return
        }
        localStorage.removeItem('fanqie:books:book-entry-session')
      }).catch(() => {})
    }

    const raw = localStorage.getItem('fanqie:books:active-session')
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as { sessionId: string; bookId: string; chapterId: string }
      fetch(`/api/sessions/${saved.sessionId}`).then((res) => res.json()).then((data) => {
        if (data.session && (data.session.status === 'running' || data.session.status === 'waiting-answer' || data.session.status === 'waiting-permission')) {
          setSessionId(saved.sessionId)
          setProcessingChapterId(saved.chapterId)
          setExpandedBookId(saved.bookId)
          setSessionStatus('running')
        }
      }).catch(() => {})
    } catch {}
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (expandedBookId) localStorage.setItem('fanqie:books:selected-book', expandedBookId)
    else localStorage.removeItem('fanqie:books:selected-book')
  }, [expandedBookId])

  const parsedBookEntryContent = parseBookEntrySections([{ stream: 'stdout', text: bookEntryContent }])
  const selectedBook = books.find((book) => book.id === expandedBookId) ?? null
  const availablePlatformAccounts = platformAccounts[publicationPlatform] || []
  const selectedBookSummary = selectedBook?.summary ?? {
    ...EMPTY_SUMMARY,
    totalChapters: selectedBook?.chapters.length ?? 0,
  }
  const processingChapter = selectedBook?.chapters.find((chapter) => chapter.id === processingChapterId) ?? null
  const selectedBookMasterSession = expandedBookId
    ? (bookSessions[expandedBookId] || []).find((session) => session.currentSkill === 'book-master-session') ?? null
    : null
  const selectedBookSession = expandedBookId ? (bookSessions[expandedBookId] || []).find((session) => session.currentSkill !== 'book-master-session') ?? null : null
  const selectedPendingQuestion = (() => {
    if (!selectedBookSession?.pendingQuestionJson) return null
    try {
      const payload = JSON.parse(selectedBookSession.pendingQuestionJson) as { question?: string }
      return payload.question ?? null
    } catch {
      return null
    }
  })()

  useEffect(() => {
    if (!selectedBookSession || sessionId) return
    if (selectedBookSession.status !== 'waiting-review') return
    setSessionId(selectedBookSession.id)
    setSessionStatus('waiting-review')
    setProcessingChapterId(selectedBookSession.chapterId)
    setActiveActionLabel(selectedBookSession.currentSkill || '章节审阅')
  }, [selectedBookSession, sessionId])

  const handleCreateBook = useCallback(async (idea: string) => {
    if (!idea) return
    setBookCreationLoading(true)
    setBookEntryStepIndex(0)
    setBookEntryContent('')
    setActiveActionLabel('新建一本书')
    setSessionStatus('running')
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'prompt',
          currentSkill: 'book-entry',
          idea,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '开书请求失败')
      completedSessionIdsRef.current.delete(data.session.id)
      setSessionId(data.session.id)
      setPendingBookEntrySessionId(data.session.id)
      localStorage.setItem('fanqie:books:book-entry-session', data.session.id)
      setBookCreationOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '开书请求失败')
      setSessionStatus('failed')
    } finally {
      setBookCreationLoading(false)
    }
  }, [toast])

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

  const handleInitializeStorySetup = useCallback(async () => {
    setInitializingStorySetup(true)
    try {
      const res = await fetch('/api/story/setup', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '初始化写作基础设施失败')
      const count = Array.isArray(data.deployedFiles) ? data.deployedFiles.length : 0
      toast.success(`写作基础设施已初始化：${count} 个文件`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '初始化写作基础设施失败')
    } finally {
      setInitializingStorySetup(false)
    }
  }, [toast])

  const toggleBook = useCallback((bookId: string) => {
    setExpandedBookId((prev) => (prev === bookId ? null : bookId))
    setStageFilter('all')
    setSessionId(null)
    setSessionStatus(null)
    setProcessingChapterId(null)
  }, [])

  const handleProcess = useCallback(async (chapterId: string) => {
    setProcessingChapterId(chapterId)
    setSessionId(null)
    setSessionStatus('running')
    setActiveActionLabel('继续写')

    const currentBookId = expandedBookId
    if (!currentBookId) return

    try {
      const res = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionKey: 'chapter.continue',
          bookId: currentBookId,
          chapterId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '启动写作失败')
      completedSessionIdsRef.current.delete(data.session.id)
      setSessionId(data.session.id)
      localStorage.setItem('fanqie:books:active-session', JSON.stringify({ sessionId: data.session.id, bookId: currentBookId, chapterId }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '处理请求失败')
      setProcessingChapterId(null)
      setSessionStatus(null)
    }
  }, [expandedBookId, toast])

  const chapterActionLabelMap: Record<ChapterActionKey, string> = {
    'chapter-polish': '润色',
    'chapter-deslop': '去AI味',
    'chapter-review': '审稿',
    'chapter-rewrite': '重写本章',
  }

  const actionKeyMap: Record<ChapterActionKey, string> = {
    'chapter-polish': 'chapter.polish',
    'chapter-deslop': 'chapter.deslop',
    'chapter-review': 'chapter.review',
    'chapter-rewrite': 'chapter.rewrite',
  }

  const handleChapterAction = useCallback(async (chapterId: string, action: ChapterActionKey) => {
    if (!expandedBookId) return
    setProcessingChapterId(chapterId)
    setSessionId(null)
    setSessionStatus('running')
    setActiveActionLabel(chapterActionLabelMap[action])
    setOpenActionChapterId(null)

    try {
      const res = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionKey: actionKeyMap[action] || action,
          bookId: expandedBookId,
          chapterId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '章节操作启动失败')
      completedSessionIdsRef.current.delete(data.session.id)
      setSessionId(data.session.id)
      localStorage.setItem('fanqie:books:active-session', JSON.stringify({ sessionId: data.session.id, bookId: expandedBookId, chapterId }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '章节高级操作请求失败')
      setProcessingChapterId(null)
      setSessionStatus(null)
    }
  }, [expandedBookId, toast])

  const handleTaskDone = useCallback(async (status: string) => {
    if (!sessionId) return
    if (completedSessionIdsRef.current.has(sessionId)) return
    completedSessionIdsRef.current.add(sessionId)

    const success = status === 'succeeded'
    setSessionStatus(success ? 'succeeded' : 'failed')

    if (pendingBookEntrySessionId === sessionId) {
      if (success) {
        setBookEntryStepIndex(5)
        await fetch('/api/books/scan', { method: 'POST' }).catch(() => {})
        await loadBooks()
        toast.success('开书流程完成，请扫描确认新书已录入')
      } else {
        toast.error('新建一本书失败')
      }
      setPendingBookEntrySessionId(null)
      localStorage.removeItem('fanqie:books:book-entry-session')
      return
    }

    localStorage.removeItem('fanqie:books:active-session')
    if (success) {
      toast.success('章节处理完成，请确认阶段推进')
    } else {
      setProcessingChapterId(null)
      toast.error('章节处理失败')
    }
    await loadBooks()
  }, [toast, pendingBookEntrySessionId, sessionId, loadBooks])

  const handleMarkComplete = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/sessions/${sessionId}/complete`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '标记完成失败')
      toast.success('已标记完成，正在刷新数据…')
      await loadBooks()
      setSessionStatus('succeeded')
      setProcessingChapterId(null)
      localStorage.removeItem('fanqie:books:active-session')
      localStorage.removeItem('fanqie:books:book-entry-session')
      setPendingBookEntrySessionId(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '标记完成失败')
    }
  }, [sessionId, loadBooks, toast])

  const handleConfirmChapterStage = useCallback(async (chapter: ChapterRow) => {
    const targetStage = NEXT_STAGE[chapter.stage]
    if (!targetStage) return

    try {
      const res = await fetch(`/api/chapters/${chapter.id}/confirm-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStage }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '确认阶段失败')
      toast.success(`已确认推进到「${targetStage}」`)
      setProcessingChapterId(null)
      setSessionId(null)
      setSessionStatus(null)
      setActiveActionLabel(null)
      await reloadExpandedBook()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '确认阶段失败')
    }
  }, [reloadExpandedBook, toast])

  const loadPlatformAccounts = useCallback(async (platform: KnownPlatform) => {
    try {
      const res = await fetch(`/api/platform-accounts?platform=${platform}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '加载平台账号失败')
      const nextAccounts = (data.accounts || []) as PlatformAccountOption[]
      setPlatformAccounts((prev) => ({ ...prev, [platform]: nextAccounts }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载平台账号失败')
    }
  }, [toast])

  useEffect(() => {
    if (!selectedBook) return
    void loadPlatformAccounts(publicationPlatform)
  }, [selectedBook, publicationPlatform, loadPlatformAccounts])

  useEffect(() => {
    const accountIds = new Set(availablePlatformAccounts.map((account) => account.id))
    setSelectedPlatformAccountId((prev) => {
      if (!availablePlatformAccounts.length) return ''
      if (prev && accountIds.has(prev)) return prev
      return availablePlatformAccounts[0]?.id || ''
    })
  }, [availablePlatformAccounts, expandedBookId, publicationPlatform])

  const handleCompressBookSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/compress`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '压缩上下文失败')
      toast.success('已压缩上下文')
      await reloadExpandedBook()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '压缩上下文失败')
    }
  }, [toast, reloadExpandedBook])

  const handlePublishPublication = useCallback(async (publicationId: string) => {
    setPublishingPublicationId(publicationId)
    try {
      const res = await fetch(`/api/book-publications/${publicationId}/publish-chapters`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 501 || data.status === 'not-wired') {
        toast.info('发布章节功能暂未接线')
      } else if (res.ok) {
        toast.success('已发起发布章节')
        await reloadExpandedBook()
      } else {
        throw new Error(data.error || '发布章节失败')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布章节失败')
    } finally {
      setPublishingPublicationId(null)
    }
  }, [reloadExpandedBook, toast])

  const handleVerifyPublication = useCallback(async (publicationId: string) => {
    setVerifyingPublicationId(publicationId)
    try {
      const res = await fetch(`/api/book-publications/${publicationId}/verify-chapters`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 501 || data.status === 'not-wired') {
        toast.info('校验章节功能暂未接线')
      } else if (res.ok) {
        toast.success('已发起校验章节')
        await reloadExpandedBook()
      } else {
        throw new Error(data.error || '校验章节失败')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '校验章节失败')
    } finally {
      setVerifyingPublicationId(null)
    }
  }, [reloadExpandedBook, toast])

  const handleCreatePublication = useCallback(async () => {
    if (!expandedBookId || !selectedPlatformAccountId) return
    setCreatingPublication(true)
    try {
      const res = await fetch(`/api/books/${expandedBookId}/publications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: publicationPlatform,
          platformAccountId: selectedPlatformAccountId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || '新增发布平台失败')
        return
      }
      toast.success('发布平台已添加')
      await reloadExpandedBook()
    } catch {
      toast.error('新增发布平台失败')
    } finally {
      setCreatingPublication(false)
    }
  }, [expandedBookId, publicationPlatform, reloadExpandedBook, selectedPlatformAccountId, toast])

  const handleDeleteBook = useCallback(async (book: BookWithChapters) => {
    const confirmed = window.confirm(`删除《${book.title}》？\n\n会同时删除这本书的 ${book.chapters.length} 个章节文件、发布记录和会话记录。`)
    if (!confirmed) return

    setDeletingBookId(book.id)
    try {
      const res = await fetch(`/api/books/${book.id}`, { method: 'DELETE' })
      const data = res.status === 204 ? {} : await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '删除书籍失败')
      if (expandedBookId === book.id) {
        setExpandedBookId(null)
        setSessionId(null)
        setProcessingChapterId(null)
        setSessionStatus(null)
      }
      localStorage.removeItem('fanqie:books:active-session')
      toast.success('书籍已删除')
      await loadBooks()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除书籍失败')
    } finally {
      setDeletingBookId(null)
    }
  }, [expandedBookId, loadBooks, toast])

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
            <Button onClick={() => setBookCreationOpen(true)}>新建一本书</Button>
            <Button variant="secondary" onClick={loadBooks}>刷新</Button>
            <Button onClick={handleScan} loading={scanning}>扫描 novels/ 目录</Button>
          </>
        }
      />

      <BookCreationModal
        open={bookCreationOpen}
        onClose={() => setBookCreationOpen(false)}
        onSubmit={handleCreateBook}
        loading={bookCreationLoading}
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

      {sessionId && (
        <Card style={{ marginBottom: spacing.xl }}>
          <div style={{ display: 'grid', gap: spacing.md }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' }}>
              <div style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold }}>当前执行</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                {sessionStatus === 'succeeded' && <Badge variant="success">✓ 已完成</Badge>}
                {sessionStatus === 'failed' && <Badge variant="error">✕ 失败</Badge>}
                {sessionStatus === 'running' && <Badge variant="warning">执行中</Badge>}
                {sessionStatus === 'waiting-review' && <Badge variant="warning">待审阅</Badge>}
                {sessionStatus === 'running' && (
                  <Button variant="primary" size="sm" onClick={handleMarkComplete}>标记完成</Button>
                )}
              </div>
            </div>
            <div style={{ fontSize: fontSize.sm, color: 'var(--text-muted)' }}>
              {activeActionLabel || '处理中'}{processingChapter ? ` · 第${processingChapter.chapter_number}章 ${processingChapter.title}` : ''}
            </div>

            {sessionStatus === 'waiting-review' && (
              <ReviewCheckpointCard
                sessionId={sessionId}
                sessionStatus={sessionStatus}
                onResolved={() => void loadBooks()}
              />
            )}

            {activeActionLabel === '新建一本书' && (
              <div style={{ display: 'grid', gap: spacing.md }}>
                <div style={{ display: 'grid', gap: spacing.sm }}>
                  {BOOK_ENTRY_STEPS.map((step, index) => (
                    <div key={step} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                      <Badge variant={bookEntryStepIndex !== null && index <= bookEntryStepIndex ? 'success' : 'neutral'}>
                        {index + 1}
                      </Badge>
                      <span style={{ fontSize: fontSize.sm, fontWeight: index === bookEntryStepIndex ? fontWeight.semibold : fontWeight.normal }}>
                        {step}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gap: spacing.sm }}>
                  <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold }}>生成结果</div>
                  <div style={{ display: 'grid', gap: spacing.sm }}>
                    <div>
                      <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>生成书名</div>
                      <div>{parsedBookEntryContent.title || '等待生成...'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>生成简介</div>
                      <div>{parsedBookEntryContent.summary || '等待生成...'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>生成大纲</div>
                      <div>{parsedBookEntryContent.outline || '等待生成...'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>生成章节目录</div>
                      <div>{parsedBookEntryContent.chapterCatalog || '等待生成...'}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <LiveLogPanel
              taskId={sessionId}
              streamBase="sessions"
              onDone={handleTaskDone}
              onChunk={(chunk) => {
                if (activeActionLabel !== '新建一本书' || chunk.stream === 'stderr') return
                setBookEntryContent((prev) => {
                  const next = prev + chunk.text
                  const parsed = parseBookEntrySections([{ stream: 'stdout', text: next }])
                  if (parsed.title) setBookEntryStepIndex((current) => Math.max(current ?? 0, 0))
                  if (parsed.summary) setBookEntryStepIndex((current) => Math.max(current ?? 0, 1))
                  if (parsed.outline) setBookEntryStepIndex((current) => Math.max(current ?? 0, 2))
                  if (parsed.chapterCatalog) setBookEntryStepIndex((current) => Math.max(current ?? 0, 3))
                  return next
                })
              }}
            />
          </div>
        </Card>
      )}

      {books.length === 0 ? (
        <Card>
          <EmptyState
            icon="◉"
            title="暂无书籍"
            description="点击「扫描 novels/ 目录」导入工作区中的小说"
            action={{ label: '扫描 novels/ 目录', onClick: handleScan }}
          />
          <div style={{ marginTop: spacing.lg, paddingTop: spacing.lg, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
            <Button variant="secondary" onClick={handleInitializeStorySetup} loading={initializingStorySetup}>初始化写作基础设施</Button>
          </div>
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
                  <div style={{ display: 'flex', gap: spacing.sm - 2, alignItems: 'center' }}>
                    {bookPublished > 0 && <Badge variant="success">{bookPublished} 已发布</Badge>}
                    {bookPending > 0 && <Badge variant="warning">{bookPending} 待处理</Badge>}
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={deletingBookId === book.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleDeleteBook(book)
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>

                {/* Expanded content */}
                {expanded && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    <div style={{
                      padding: `${spacing.lg}px ${spacing.xl}px`,
                      borderBottom: '1px solid var(--border)',
                      display: 'grid',
                      gap: spacing.lg,
                      background: theme === 'light'
                        ? 'linear-gradient(180deg, #fffdf8, #f8f0e4)'
                        : 'linear-gradient(180deg, #1f1915, #181310)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing.lg, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)', marginBottom: 4 }}>
                            当前工作区
                          </div>
                          <div style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold }}>
                            {selectedBook?.title ?? book.title}
                          </div>
                          <div style={{ fontSize: fontSize.sm, color: 'var(--text-muted)', marginTop: 4 }}>
                            先看全书进度，再继续处理具体章节
                          </div>
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: spacing.sm,
                          padding: `${spacing.xs}px ${spacing.md}px`,
                          borderRadius: 999,
                          background: theme === 'light' ? '#f2e7d7' : '#2a211b',
                          color: theme === 'light' ? '#7e6650' : '#d4bba3',
                          fontSize: fontSize.xs,
                          fontWeight: fontWeight.medium,
                        }}>
                          <span>活跃会话</span>
                          <span style={{ fontWeight: fontWeight.semibold }}>
                            {selectedBookSummary.activeSessionId ? '进行中' : '暂无'}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: spacing.md }}>
                        {[
                          { label: '总章节', value: `${selectedBookSummary.totalChapters}` },
                          { label: '可发布', value: `${selectedBookSummary.publishableCount} 章` },
                          { label: '待写作', value: `${selectedBookSummary.byStage['待写作']} 章` },
                          { label: '已发布', value: `${selectedBookSummary.byStage['已发布']} 章` },
                        ].map((item) => (
                          <div
                            key={item.label}
                            style={{
                              padding: `${spacing.md}px ${spacing.lg}px`,
                              borderRadius: radius.md,
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border)',
                              display: 'grid',
                              gap: 6,
                            }}
                          >
                            <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>{item.label}</div>
                            <div style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold }}>
                              {item.label === '总章节' ? `${item.label} ${item.value}` : `${item.label} ${item.value}`}
                            </div>
                          </div>
                        ))}
                      </div>

                      <BookSessionPanel
                        session={selectedBookMasterSession ? {
                          id: selectedBookMasterSession.id,
                          status: selectedBookMasterSession.status,
                          currentSkill: selectedBookMasterSession.currentSkill,
                          updatedAt: selectedBookMasterSession.updatedAt,
                          metadata: {
                            compressedAt: selectedBookMasterSession.compressedAt,
                          },
                        } : null}
                        onCompress={() => {
                          if (selectedBookMasterSession) void handleCompressBookSession(selectedBookMasterSession.id)
                        }}
                        onViewContext={() => setContextOpen((v) => !v)}
                      />

                      {contextOpen && selectedBook && (
                        <Card>
                          <div style={{ display: 'grid', gap: spacing.sm }}>
                            <div style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold }}>当前上下文</div>
                            <div>书名：{selectedBook.title}</div>
                            <div>总章节：{selectedBookSummary.totalChapters}</div>
                            <div>待写作：{selectedBookSummary.byStage['待写作']}</div>
                          </div>
                        </Card>
                      )}
                    </div>

                    <div style={{ padding: `${spacing.lg}px ${spacing.xl}px`, borderBottom: '1px solid var(--border)', display: 'grid', gap: spacing.md }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold }}>发布平台</div>
                        <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>Book → BookPublications → ChapterPublications</div>
                      </div>

                      {book.publications.length === 0 ? (
                        <div style={{ fontSize: fontSize.sm, color: 'var(--text-muted)' }}>暂未配置发布平台</div>
                      ) : (
                        <div style={{ display: 'grid', gap: spacing.md }}>
                          {book.publications.map((publication) => {
                            const accountBadge = accountStatusBadge[publication.account.status] || accountStatusBadge['needs-login']
                            return (
                              <div
                                key={publication.id}
                                style={{
                                  border: '1px solid var(--border)',
                                  borderRadius: radius.md,
                                  background: 'var(--bg-secondary)',
                                  padding: `${spacing.md}px ${spacing.lg}px`,
                                  display: 'grid',
                                  gap: spacing.sm,
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap', alignItems: 'center' }}>
                                  <div style={{ display: 'grid', gap: 4 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                                      <span style={{ fontWeight: fontWeight.semibold }}>{getPlatformLabel(publication.platform)}</span>
                                      <Badge variant={accountBadge.variant}>{accountBadge.label}</Badge>
                                      <Badge variant={publication.status === 'bound' ? 'success' : publication.status === 'paused' ? 'warning' : 'neutral'}>
                                        {publicationStatusLabel[publication.status]}
                                      </Badge>
                                    </div>
                                    <div style={{ fontSize: fontSize.sm, color: 'var(--text-muted)' }}>
                                      账号：{publication.account.label}
                                    </div>
                                    <div style={{ fontSize: fontSize.sm, color: 'var(--text-muted)' }}>
                                      平台书籍：{publication.platformBookId || '未绑定平台书籍'}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => handlePublishPublication(publication.id)}
                                      loading={publishingPublicationId === publication.id}
                                      disabled={!publication.canPublish}
                                    >
                                      发布章节
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => handleVerifyPublication(publication.id)}
                                      loading={verifyingPublicationId === publication.id}
                                    >
                                      校验章节
                                    </Button>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap', fontSize: fontSize.sm }}>
                                  <span>待处理 {publication.chapterStatusCounts.pending}</span>
                                  <span>已同步 {publication.chapterStatusCounts.synced}</span>
                                  <span>已发布 {publication.chapterStatusCounts.published}</span>
                                  <span>失败 {publication.chapterStatusCounts.failed}</span>
                                </div>

                                <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>
                                  最近发布时间：{publication.latestPublishedAt ? new Date(publication.latestPublishedAt).toLocaleString('zh-CN') : '暂无'} · {publication.canPublish ? '可发布' : '当前不可发布'}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <div style={{ borderTop: '1px dashed var(--border)', paddingTop: spacing.md, display: 'grid', gap: spacing.sm }}>
                        <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold }}>新增发布平台</div>
                        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
                          <select
                            aria-label="选择发布平台"
                            value={publicationPlatform}
                            onChange={(e) => {
                              const nextPlatform = e.currentTarget.value as KnownPlatform
                              setPublicationPlatform(nextPlatform)
                              setSelectedPlatformAccountId('')
                            }}
                            style={{
                              padding: `${spacing.sm}px ${spacing.md}px`,
                              background: 'var(--bg-primary)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: radius.md,
                              fontFamily: 'inherit',
                            }}
                          >
                            {PUBLICATION_PLATFORMS.map((platform) => (
                              <option key={platform} value={platform}>{getPlatformLabel(platform)}</option>
                            ))}
                          </select>

                          <select
                            aria-label="选择平台账号"
                            value={selectedPlatformAccountId}
                            onChange={(e) => setSelectedPlatformAccountId(e.currentTarget.value)}
                            style={{
                              padding: `${spacing.sm}px ${spacing.md}px`,
                              background: 'var(--bg-primary)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border)',
                              borderRadius: radius.md,
                              fontFamily: 'inherit',
                              minWidth: 180,
                            }}
                          >
                            <option value="">选择账号</option>
                            {availablePlatformAccounts.map((account) => (
                              <option key={account.id} value={account.id}>{account.label}</option>
                            ))}
                          </select>

                          <Button onClick={handleCreatePublication} loading={creatingPublication} disabled={!selectedPlatformAccountId}>
                            新增发布平台
                          </Button>
                        </div>
                      </div>
                    </div>

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
                      margin: `${spacing.md}px ${spacing.xl}px 0`,
                      padding: `${spacing.md}px ${spacing.lg}px`,
                      borderRadius: radius.md,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-secondary)',
                      display: 'grid',
                      gap: spacing.sm,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold }}>当前会话</div>
                        <Badge variant={selectedBookSession?.status === 'waiting-answer' ? 'warning' : selectedBookSession ? 'success' : 'neutral'}>
                          {selectedBookSession?.status === 'waiting-answer' ? '待回答' : selectedBookSession ? '最近活跃' : '暂无会话'}
                        </Badge>
                      </div>
                      {selectedBookSession ? (
                        <>
                          <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>
                            {selectedBookSession.currentSkill || selectedBookSession.kind} · {new Date(selectedBookSession.updatedAt).toLocaleString('zh-CN')}
                          </div>
                          {selectedPendingQuestion && (
                            <div style={{ fontSize: fontSize.sm, color: 'var(--text-primary)' }}>{selectedPendingQuestion}</div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>选中章节后会在这里显示当前进度与提问。</div>
                      )}
                    </div>

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
                        const nextStage = NEXT_STAGE[ch.stage]

                        return (
                          <div key={ch.id}>
                            <div
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
                                <button
                                  type="button"
                                  onClick={() => setReadingChapterId(ch.id)}
                                  title="点击阅读这一章"
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 0,
                                    margin: 0,
                                    cursor: 'pointer',
                                    fontSize: fontSize.md + 1,
                                    fontWeight: fontWeight.semibold,
                                    fontFamily: 'inherit',
                                    color: theme === 'light' ? '#4b3b2f' : '#f1e1d2',
                                    lineHeight: 1.4,
                                    textAlign: 'left',
                                    transition: `color ${transition.normal}`,
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                                  onMouseLeave={(e) => (e.currentTarget.style.color = theme === 'light' ? '#4b3b2f' : '#f1e1d2')}
                                >
                                  {ch.title}
                                </button>
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
                              <button
                                type="button"
                                onClick={() => setReadingChapterId(ch.id)}
                                title="阅读本章"
                                style={{
                                  padding: '4px 10px',
                                  background: 'transparent',
                                  border: theme === 'light' ? '1px solid #eadfcf' : '1px solid #3f3127',
                                  borderRadius: radius.sm,
                                  color: theme === 'light' ? '#8b7461' : '#c7ae97',
                                  fontSize: fontSize.xs,
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  transition: `all ${transition.normal}`,
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = 'var(--accent)'
                                  e.currentTarget.style.borderColor = 'var(--accent)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.color = theme === 'light' ? '#8b7461' : '#c7ae97'
                                  e.currentTarget.style.borderColor = theme === 'light' ? '#eadfcf' : '#3f3127'
                                }}
                              >
                                阅读
                              </button>
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
                              {sessionStatus === 'succeeded' && isProcessing && nextStage ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => void handleConfirmChapterStage(ch)}
                                >
                                  确认{nextStage}
                                </Button>
                              ) : isReady ? (
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
                                <>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setOpenActionChapterId((prev) => prev === ch.id ? null : ch.id)}
                                  >
                                    ···
                                  </Button>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => handleProcess(ch.id)}
                                  >
                                    处理
                                  </Button>
                                </>
                              )}
                            </div>
                            {openActionChapterId === ch.id && !isOtherProcessing && !isProcessing && (
                              <div style={{ margin: `0 ${spacing.xl}px ${spacing.sm}px` }}>
                                <ChapterActionMenu onSelect={(action) => handleChapterAction(ch.id, action)} />
                              </div>
                            )}
                          </div>
                        </div>
                        )
                      })
                    )}

                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
      {readingChapterId && (
        <ChapterReader
          chapterId={readingChapterId}
          onClose={() => setReadingChapterId(null)}
          onNavigate={(id) => setReadingChapterId(id)}
        />
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
