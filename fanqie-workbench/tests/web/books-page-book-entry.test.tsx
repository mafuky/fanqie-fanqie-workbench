import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { BooksPage } from '../../src/web/pages/books-page.js'

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../../src/web/components/ui/toast.js', () => ({
  useToast: () => toastStub,
  ToastProvider: ({ children }: any) => children,
}))

class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 0
  listeners: Record<string, ((e: any) => void)[]> = {}
  sent: any[] = []
  constructor(public url: string) { FakeSocket.last = this }
  addEventListener(type: string, cb: (e: any) => void) { (this.listeners[type] ??= []).push(cb) }
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close() {}
  fire(type: string, evt: any) { (this.listeners[type] ?? []).forEach((cb) => cb(evt)) }
}

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
    FakeSocket.last = null
    MockEventSource.instances = []
    ;(globalThis as any).WebSocket = FakeSocket as any
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

  it('submits POST /api/agent-sessions/book-create and renders AgentPanel', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (input === '/api/agent-sessions/book-create' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ sessionId: 'book-agent-1', bookId: 'new-book-1', status: 'running', traceId: 'trace-1' }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/agent-sessions/book-create', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: '现代悬疑复仇文，强反转' }),
      }))
    })

    // AgentPanel should mount with the new sessionId
    await waitFor(() => {
      expect(FakeSocket.last?.url).toContain('book-agent-1')
    })
    expect(await screen.findByTestId('agent-panel')).toBeTruthy()
  })

  it('shows inline error when POST returns 4xx', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (input === '/api/agent-sessions/book-create' && init?.method === 'POST') {
        return { ok: false, json: async () => ({ error: '书名已存在' }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '重名书' } })
    fireEvent.click(screen.getByText('开始生成'))

    expect(await screen.findByText('书名已存在')).toBeTruthy()
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
      if (input === '/api/actions') return { ok: true, json: async () => ({ session: { id: 's-polish', kind: 'chapter', status: 'running' } }) }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)
    fireEvent.click(await screen.findByText('雾港疑局'))
    fireEvent.click(await screen.findByText('···'))
    fireEvent.click(await screen.findByText('润色'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/actions', expect.objectContaining({ method: 'POST' }))
    })
  })

  it('reloads books after agent succeeds', async () => {
    let booksCallCount = 0
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') {
        booksCallCount++
        if (booksCallCount <= 1) {
          return { ok: true, json: async () => ({ books: [] }) }
        }
        return { ok: true, json: async () => ({ books: [{ id: 'book-1', title: '雾港疑局', root_path: '/tmp/book-1', account_id: null }] }) }
      }
      if (input === '/api/agent-sessions/book-create' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ sessionId: 'book-agent-1', bookId: 'book-1', status: 'running', traceId: 'trace-1' }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<BooksPage />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => expect(FakeSocket.last?.url).toContain('book-agent-1'))

    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'done', status: 'succeeded' }) })
    })

    await waitFor(() => {
      expect(booksCallCount).toBeGreaterThanOrEqual(2)
    })
  })
})
