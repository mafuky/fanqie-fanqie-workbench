import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
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
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>()
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

describe('BooksPage book entry', () => {
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

  it('opens new book modal with example copy and clickable presets', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('新建一本书'))

    expect(await screen.findByText('开书想法')).toBeTruthy()
    expect(await screen.findByText('开始生成')).toBeTruthy()
    expect(await screen.findByText('常用模板')).toBeTruthy()
    expect(await screen.findByText('现代悬疑复仇文，强反转')).toBeTruthy()

    fireEvent.click(screen.getByText('现代悬疑复仇文，强反转'))
    expect((await screen.findByLabelText('开书想法')).getAttribute('value') || (await screen.findByLabelText('开书想法') as HTMLTextAreaElement).value).toContain('现代悬疑复仇文，强反转')
  })

  it('shows staged book-entry progress with full generated content', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (input === '/api/sessions') return { ok: true, json: async () => ({ session: { id: 'book-entry-1', kind: 'prompt', status: 'running' } }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    const stream = await waitFor(() => {
      const instance = MockEventSource.instances.find((candidate) => candidate.url.includes('/api/sessions/book-entry-1/stream'))
      expect(instance).toBeTruthy()
      return instance
    })
    stream?.onmessage?.({ data: JSON.stringify({ stream: 'stdout', chunk: '书名：雾港疑局\n简介：都市连环失踪案背后的复仇棋局\n大纲：第一卷雾港失踪案\n章节目录：\n第1章 雾夜失踪' }) } as MessageEvent)

    expect((await screen.findAllByText('执行日志')).length).toBe(1)
    expect((await screen.findAllByText('生成书名')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('生成简介')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('生成大纲')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('生成章节目录')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('雾港疑局')).length).toBeGreaterThan(0)
    expect(await screen.findByText('都市连环失踪案背后的复仇棋局')).toBeTruthy()
    expect(await screen.findByText('第一卷雾港失踪案')).toBeTruthy()
    expect(await screen.findByText('第1章 雾夜失踪')).toBeTruthy()
  })

  it('submits a book-entry session from the new book modal', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (input === '/api/sessions') return { ok: true, json: async () => ({ session: { id: 'book-entry-1', kind: 'prompt', status: 'running' } }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'prompt',
          currentSkill: 'book-entry',
          idea: '现代悬疑复仇文，强反转',
        }),
      }))
    })

    expect(await screen.findByText('当前执行')).toBeTruthy()
  })

  it('opens chapter action menu with advanced actions', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局' },
          chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '已初稿' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 0, '已初稿': 1, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: null,
            activeChapterId: null,
          },
        }) }
      }
      if (input === '/api/books/b1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)
    fireEvent.click(await screen.findByText('雾港疑局'))
    fireEvent.click(await screen.findByText('···'))

    expect(await screen.findByText('润色')).toBeTruthy()
    expect(await screen.findByText('去AI味')).toBeTruthy()
    expect(await screen.findByText('审稿')).toBeTruthy()
    expect(await screen.findByText('重写本章')).toBeTruthy()
  })

  it('starts chapter polish as a session and shows the action in the shared panel', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [{ id: 'b1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      if (input === '/api/books/b1') {
        return { ok: true, json: async () => ({
          book: { id: 'b1', title: '雾港疑局' },
          chapters: [{ id: 'c1', chapter_number: 1, title: '雾夜失踪', stage: '已初稿' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 0, '已初稿': 1, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: null,
            activeChapterId: null,
          },
        }) }
      }
      if (input === '/api/books/b1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/b1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/sessions') return { ok: true, json: async () => ({ session: { id: 's-polish', kind: 'chapter', status: 'running' } }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)
    fireEvent.click(await screen.findByText('雾港疑局'))
    fireEvent.click(await screen.findByText('···'))
    fireEvent.click(await screen.findByText('润色'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' }))
    })
  })

  it('keeps only the final book-entry payload out of multi-turn history', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (input === '/api/sessions') return { ok: true, json: async () => ({ session: { id: 'book-entry-1', kind: 'prompt', status: 'running' } }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    const stream = await waitFor(() => {
      const instance = MockEventSource.instances.find((candidate) => candidate.url.includes('/api/sessions/book-entry-1/stream'))
      expect(instance).toBeTruthy()
      return instance
    })
    stream?.onmessage?.({ data: JSON.stringify({ id: 1, stream: 'stdout', chunk: '这个方向需要继续确认\n' }) } as MessageEvent)
    stream?.onmessage?.({ data: JSON.stringify({ id: 2, stream: 'question', chunk: '纯爽' }) } as MessageEvent)
    stream?.onmessage?.({ data: JSON.stringify({ id: 3, stream: 'stdout', chunk: '书名：最终书名\n简介：最终简介\n大纲：最终大纲\n章节目录：\n第1章 第一章' }) } as MessageEvent)
    stream?.onmessage?.({ data: JSON.stringify({ id: 3, stream: 'stdout', chunk: '书名：最终书名\n简介：最终简介\n大纲：最终大纲\n章节目录：\n第1章 第一章' }) } as MessageEvent)

    expect(await screen.findByText('最终书名')).toBeTruthy()
    expect(await screen.findByText('最终简介')).toBeTruthy()
    expect(await screen.findByText('最终大纲')).toBeTruthy()
    expect(await screen.findByText('第1章 第一章')).toBeTruthy()
    expect(screen.queryByText('这个方向需要继续确认')).toBeTruthy()
    expect(screen.queryByText('纯爽')).toBeTruthy()
    expect(screen.queryByText((content) => content.includes('第1章 第一章书名：最终书名'))).toBeNull()
  })

  it('reloads books and selects the created book when book-entry session completes', async () => {
    let booksCallCount = 0
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        booksCallCount += 1
        if (booksCallCount === 1) {
          return { ok: true, json: async () => ({ books: [] }) }
        }
        return { ok: true, json: async () => ({ books: [{ id: 'book-1', title: '雾港疑局', root_path: '/tmp/book-1', account_id: null }] }) }
      }
      if (input === '/api/sessions') {
        return { ok: true, json: async () => ({ session: { id: 'book-entry-1', kind: 'prompt', status: 'running' } }) }
      }
      if (input === '/api/sessions/book-entry-1') {
        return { ok: true, json: async () => ({ session: { id: 'book-entry-1', kind: 'prompt', status: 'succeeded', contextSnapshotJson: JSON.stringify({ createdBookId: 'book-1' }) } }) }
      }
      if (input === '/api/books/book-1') {
        return { ok: true, json: async () => ({
          book: { id: 'book-1', title: '雾港疑局' },
          chapters: [{ id: 'ch-1', chapter_number: 1, title: '雾夜失踪', stage: '待写作' }],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 1, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 0, '发布中': 0, '已发布': 0 },
            publishableCount: 0,
            activeSessionId: null,
            activeChapterId: null,
          },
        }) }
      }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    const stream = await waitFor(() => {
      const instance = MockEventSource.instances.find((candidate) => candidate.url.includes('/api/sessions/book-entry-1/stream'))
      expect(instance).toBeTruthy()
      return instance
    })
    stream?.onmessage?.({ data: JSON.stringify({ stream: 'stdout', chunk: '书名：雾港疑局' }) } as MessageEvent)
    stream?.onmessage?.({ data: JSON.stringify({ stream: 'stdout', chunk: '第1章：雾夜失踪' }) } as MessageEvent)
    stream?.onmessage?.({ data: JSON.stringify({ stream: 'stdout', chunk: '章节目录：第1章 雾夜失踪' }) } as MessageEvent)
    ;(stream as any)?.dispatchDone?.('succeeded')

    await waitFor(() => {
      expect(screen.getAllByText('雾港疑局').length).toBeGreaterThan(0)
      expect(screen.getByText('当前工作区')).toBeTruthy()
      expect(localStorage.getItem('fanqie:books:selected-book')).toBe('book-1')
    })
  })
})
