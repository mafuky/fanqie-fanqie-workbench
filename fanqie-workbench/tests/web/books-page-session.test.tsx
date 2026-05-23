import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { BooksPage } from '../../src/web/pages/books-page.js'

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../../src/web/components/ui/toast.js', () => ({
  useToast: () => toastStub,
  ToastProvider: ({ children }: any) => children,
}))

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (event: MessageEvent) => void) {
    const arr = this.listeners.get(type) || []
    arr.push(cb)
    this.listeners.set(type, arr)
  }
  dispatchDone(status: string) {
    for (const cb of this.listeners.get('done') || []) {
      cb({ data: JSON.stringify({ status }) } as MessageEvent)
    }
  }
  close() {}
}

describe('BooksPage session model', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    ;(globalThis as any).EventSource = MockEventSource as any
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('initializes oh-story writing infrastructure from the page action', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (input === '/api/story/setup' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ deployedFiles: ['.claude/hooks/session-start.sh', '.story-deployed'] }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('初始化写作基础设施'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/story/setup', expect.objectContaining({ method: 'POST' }))
    })
    expect(toastStub.success).toHaveBeenCalledWith('写作基础设施已初始化：2 个文件')
  })

  it('creates a chapter action when processing a chapter', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({ book: { id: 'b1', title: '雾港疑局' }, chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }] }) }
      }
      if (input === '/api/actions' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ session: { id: 's1', kind: 'chapter', status: 'running' } }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('雾港疑局'))
    fireEvent.click(await screen.findByText('处理'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/actions', expect.objectContaining({
        method: 'POST',
      }))
    })
  })

  it('restores last active chapter session from localStorage', async () => {
    localStorage.setItem('fanqie:books:active-session', JSON.stringify({ sessionId: 's-active', bookId: 'b1', chapterId: 'c1' }))

    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局' },
          chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: 's-active',
            activeChapterId: 'c1',
          },
        }) }
      }
      if (input === '/api/sessions/s-active') {
        return { ok: true, json: async () => ({ session: { id: 's-active', kind: 'chapter', status: 'running' } }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions/s-active')
    })
  })

  it('clears stale selected book when the book list is empty', async () => {
    localStorage.setItem('fanqie:books:selected-book', 'stale-book')

    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [] }) }
      }
      throw new Error(`unexpected fetch: ${input}`)
    })

    render(<BooksPage />)

    expect(await screen.findByText('暂无书籍')).toBeTruthy()
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('fanqie:books:selected-book')).toBeNull()
  })

  it('renders only one execution log panel for an active session', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局' },
          chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: 's-book',
            activeChapterId: 'c1',
          },
        }) }
      }
      if (input === '/api/books/b1/sessions') {
        return { ok: true, json: async () => ({ sessions: [] }) }
      }
      if (input === '/api/actions') {
        return { ok: true, json: async () => ({ session: { id: 's-book', kind: 'chapter', status: 'running' } }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('雾港疑局'))
    fireEvent.click(await screen.findByText('处理'))

    expect((await screen.findAllByText('执行日志')).length).toBe(1)
  })

  it('handles replayed chapter completion only once', async () => {
    let booksCallCount = 0
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        booksCallCount += 1
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局' },
          chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: null,
            activeChapterId: null,
          },
        }) }
      }
      if (input === '/api/books/b1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/b1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/actions') return { ok: true, json: async () => ({ session: { id: 's-chapter', kind: 'chapter', status: 'running' } }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('雾港疑局'))
    fireEvent.click(await screen.findByText('处理'))

    const stream = await waitFor(() => {
      const instance = MockEventSource.instances.find((candidate) => candidate.url.includes('/api/sessions/s-chapter/stream'))
      expect(instance).toBeTruthy()
      return instance
    })
    stream?.dispatchDone('succeeded')
    stream?.dispatchDone('succeeded')

    await waitFor(() => {
      expect(toastStub.success).toHaveBeenCalledTimes(1)
      expect(toastStub.success).toHaveBeenCalledWith('章节处理完成，请确认阶段推进')
    })
    await waitFor(() => {
      expect(booksCallCount).toBe(2)
    })
  })

  it('shows a visible book-level session panel for the selected book', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局' },
          chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: null,
            activeChapterId: null,
          },
        }) }
      }
      if (input === '/api/books/b1/sessions') {
        return { ok: true, json: async () => ({ sessions: [
          {
            id: 'master-1',
            kind: 'prompt',
            bookId: 'b1',
            chapterId: null,
            status: 'running',
            currentSkill: 'book-master-session',
            pendingQuestionJson: null,
            createdAt: '2026-05-14T10:00:00.000Z',
            updatedAt: '2026-05-14T10:01:00.000Z',
            metadata: { compressedAt: '2026-05-14T09:00:00.000Z' },
          },
        ] }) }
      }
      if (input === '/api/books/b1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)
    fireEvent.click(await screen.findByText('雾港疑局'))

    expect(await screen.findByText('书级主会话')).toBeTruthy()
    expect(await screen.findByText('压缩上下文')).toBeTruthy()
    expect(await screen.findByText('查看上下文')).toBeTruthy()
  })

  it('compresses the selected book master session through the panel action', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局' },
          chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: null,
            activeChapterId: null,
          },
        }) }
      }
      if (input === '/api/books/b1/sessions') {
        return { ok: true, json: async () => ({ sessions: [
          {
            id: 'master-1',
            kind: 'prompt',
            bookId: 'b1',
            chapterId: null,
            status: 'running',
            currentSkill: 'book-master-session',
            pendingQuestionJson: null,
            claudeResumeId: 'resume-1',
            compressedAt: null,
            contextSnapshotJson: null,
            createdAt: '2026-05-14T10:00:00.000Z',
            updatedAt: '2026-05-14T10:01:00.000Z',
          },
        ] }) }
      }
      if (input === '/api/books/b1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/sessions/master-1/compress' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ session: { id: 'master-1', compressedAt: '2026-05-14T12:00:00.000Z' } }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)
    fireEvent.click(await screen.findByText('雾港疑局'))
    fireEvent.click(await screen.findByText('压缩上下文'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions/master-1/compress', expect.objectContaining({ method: 'POST' }))
    })
  })

  it('opens a readable context section from the book session panel', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局' },
          chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: null,
            activeChapterId: null,
          },
        }) }
      }
      if (input === '/api/books/b1/sessions') {
        return { ok: true, json: async () => ({ sessions: [
          {
            id: 'master-1',
            kind: 'prompt',
            bookId: 'b1',
            chapterId: null,
            status: 'running',
            currentSkill: 'book-master-session',
            pendingQuestionJson: null,
            claudeResumeId: 'resume-1',
            compressedAt: '2026-05-14T12:00:00.000Z',
            contextSnapshotJson: null,
            createdAt: '2026-05-14T10:00:00.000Z',
            updatedAt: '2026-05-14T10:01:00.000Z',
          },
        ] }) }
      }
      if (input === '/api/books/b1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)
    fireEvent.click(await screen.findByText('雾港疑局'))
    fireEvent.click(await screen.findByText('查看上下文'))

    expect(await screen.findByText('当前上下文')).toBeTruthy()
    expect(await screen.findByText((content) => content.includes('书名：雾港疑局'))).toBeTruthy()
  })

  it('shows selected book summary from workspace payload', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局' },
          chapters: [
            { id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' },
            { id: 'c2', chapter_number: 2, title: '码头追踪', stage: '可发布' },
          ],
          summary: {
            totalChapters: 2,
            byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 1, '发布中': 0, '已发布': 0 },
            publishableCount: 1,
            activeSessionId: 's-book',
            activeChapterId: 'c1',
          },
        }) }
      }
      if (input === '/api/books/b1/sessions') {
        return { ok: true, json: async () => ({ sessions: [
          {
            id: 's-book',
            kind: 'chapter',
            bookId: 'b1',
            chapterId: 'c1',
            status: 'waiting-answer',
            currentSkill: 'chapter-pipeline',
            pendingQuestionJson: '{"question":"主角现在是否应该立刻追人？"}',
            createdAt: '2026-05-13T10:00:00.000Z',
            updatedAt: '2026-05-13T10:05:00.000Z',
          },
        ] }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('雾港疑局'))

    expect(await screen.findByText('可发布 1 章')).toBeTruthy()
    expect(await screen.findByText('总章节 2')).toBeTruthy()
    expect(await screen.findByText('当前会话')).toBeTruthy()
    expect(await screen.findByText('待回答')).toBeTruthy()
    expect(await screen.findByText('主角现在是否应该立刻追人？')).toBeTruthy()
    expect(localStorage.getItem('fanqie:books:selected-book')).toBe('b1')
  })

  it('shows a review checkpoint card for a waiting-review session', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局', root_path: '/tmp/book' },
          chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: 's-review',
            activeChapterId: 'c1',
          },
        }) }
      }
      if (input === '/api/books/b1/sessions') {
        return { ok: true, json: async () => ({ sessions: [{ id: 's-review', status: 'waiting-review', bookId: 'b1', chapterId: 'c1', currentSkill: 'chapter.continue' }] }) }
      }
      if (input === '/api/books/b1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/c1/content') return { ok: true, json: async () => ({ content: '## 第1章 雾夜失踪' }) }
      if (input === '/api/sessions/s-review/review-checkpoint') {
        return { ok: true, json: async () => ({
          checkpoint: {
            id: 'checkpoint-1',
            title: '第 1 章正文已完成',
            summary: { completed: ['章节正文已生成或更新'], checks: ['请在左侧编辑器中验收正文质量'] },
            changedFiles: ['正文/第001章_雾夜失踪.md'],
            options: ['accept', 'save-only'],
            status: 'pending',
          },
        }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('雾港疑局'))

    expect(await screen.findByText('阶段审阅')).toBeTruthy()
    expect(screen.getByText('第 1 章正文已完成')).toBeTruthy()
    expect(screen.getByText('接受')).toBeTruthy()
  })
})
