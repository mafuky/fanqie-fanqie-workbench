import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'

import { LibraryPage } from '../../src/web/pages/library-page.js'

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

describe('LibraryPage writing loop entry', () => {
  beforeEach(() => {
    FakeSocket.last = null
    ;(globalThis as any).WebSocket = FakeSocket as any
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows loading then books', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [{ id: 'book-1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<LibraryPage onOpenBook={vi.fn()} />)

    expect(screen.getByText('正在加载书库…')).toBeTruthy()
    expect(await screen.findByText('雾港疑局')).toBeTruthy()
  })

  it('shows load error and retries', async () => {
    let fail = true
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') {
        if (fail) return { ok: false, json: async () => ({ error: '加载书库失败' }) }
        return { ok: true, json: async () => ({ books: [{ id: 'book-1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<LibraryPage onOpenBook={vi.fn()} />)

    expect(await screen.findByText('加载书库失败')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByText('重试'))
    expect(await screen.findByText('雾港疑局')).toBeTruthy()
  })

  it('scans novels and refreshes books', async () => {
    let booksCallCount = 0
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') {
        booksCallCount += 1
        return { ok: true, json: async () => ({ books: booksCallCount === 1 ? [] : [{ id: 'book-1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      }
      if (input === '/api/books/scan' && init?.method === 'POST') return { ok: true, json: async () => ({ bookCount: 1, chapterCount: 1 }) }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<LibraryPage onOpenBook={vi.fn()} />)

    fireEvent.click(await screen.findByText('扫描 novels/'))

    expect(await screen.findByText('扫描完成：1 本书，1 章')).toBeTruthy()
    expect(await screen.findByText('雾港疑局')).toBeTruthy()
  })

  it('opens book creation modal and switches to AgentPanel on submit', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (input === '/api/agent-sessions/book-create' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ sessionId: 'book-agent-1', bookId: 'new-book-1', status: 'running', traceId: 'trace-1' }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<LibraryPage onOpenBook={vi.fn()} />)

    fireEvent.click(await screen.findByText('新建一本书'))
    expect(await screen.findByRole('heading', { name: '新建一本书' })).toBeTruthy()

    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文' } })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/agent-sessions/book-create', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: '现代悬疑复仇文' }),
      }))
    })

    // AgentPanel should mount (WebSocket opened for the session)
    await waitFor(() => {
      expect(FakeSocket.last?.url).toContain('book-agent-1')
    })
    expect(await screen.findByTestId('agent-panel')).toBeTruthy()
  })

  it('shows inline error when /api/agent-sessions/book-create returns 4xx', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (input === '/api/agent-sessions/book-create' && init?.method === 'POST') {
        return { ok: false, json: async () => ({ error: '书名已存在' }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<LibraryPage onOpenBook={vi.fn()} />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '重名书' } })
    fireEvent.click(screen.getByText('开始生成'))

    expect(await screen.findByText('书名已存在')).toBeTruthy()
  })

  it('calls onCreated and refreshes books when agent finishes with succeeded', async () => {
    let booksCallCount = 0
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') {
        booksCallCount++
        return { ok: true, json: async () => ({ books: booksCallCount >= 2 ? [{ id: 'new-book-1', title: '现代悬疑复仇文', root_path: '/tmp/b', account_id: null }] : [] }) }
      }
      if (input === '/api/agent-sessions/book-create' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ sessionId: 'book-agent-1', bookId: 'new-book-1', status: 'running', traceId: 'trace-1' }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<LibraryPage onOpenBook={vi.fn()} />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文' } })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => expect(FakeSocket.last?.url).toContain('book-agent-1'))

    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'done', status: 'succeeded' }) })
    })

    // Modal closes and books reload
    await waitFor(() => {
      expect(booksCallCount).toBeGreaterThanOrEqual(2)
    })
  })
})
