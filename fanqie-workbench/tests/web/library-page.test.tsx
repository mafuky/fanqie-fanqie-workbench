import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { LibraryPage } from '../../src/web/pages/library-page.js'

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onmessage: ((event: MessageEvent) => void) | null = null
  listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) || []
    list.push(cb)
    this.listeners.set(type, list)
  }
  emitDone(status: string) {
    for (const cb of this.listeners.get('done') || []) cb({ data: JSON.stringify({ status }) } as MessageEvent)
  }
  close() {}
}

describe('LibraryPage writing loop entry', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    ;(globalThis as any).EventSource = MockEventSource as any
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

  it('opens book creation modal and starts book-entry session', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      if (typeof input === 'string' && input.startsWith('/api/sessions') && (!init || init.method !== 'POST')) return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/sessions' && init?.method === 'POST') return { ok: true, json: async () => ({ session: { id: 'book-entry-1', status: 'running' } }) }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<LibraryPage onOpenBook={vi.fn()} />)

    fireEvent.click(await screen.findByText('新建一本书'))
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文' } })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ kind: 'prompt', currentSkill: 'book-entry', idea: '现代悬疑复仇文' }),
      }))
    })
    expect(await screen.findByText('当前动作')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: '新建一本书' })).toBeTruthy()
  })
})
