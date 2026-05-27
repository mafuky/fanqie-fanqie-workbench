import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../../src/web/app.js'

class MockMatchMedia {
  matches = false
  addEventListener() {}
  removeEventListener() {}
}

describe('App navigation', () => {
  beforeEach(() => {
    ;(window as any).matchMedia = () => new MockMatchMedia()
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [{ id: 'book-1', title: '雾港疑局', root_path: '/tmp/book', account_id: null }] }) }
      if (input === '/api/books/book-1') return { ok: true, json: async () => ({ book: { id: 'book-1', title: '雾港疑局', root_path: '/tmp/book' }, chapters: [], summary: {} }) }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/market-scans') return { ok: true, json: async () => ({ scans: [] }) }
      return { ok: true, json: async () => ({}) }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows v0.2 navigation and defaults to library', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: '书库' })).toBeTruthy()
    expect(screen.getByText('当前任务')).toBeTruthy()
    expect(screen.getByText('市场情报')).toBeTruthy()
    expect(screen.getByText('资料库')).toBeTruthy()
    expect(screen.getByText('账号发布')).toBeTruthy()
    expect(screen.getByText('设置')).toBeTruthy()
    expect(screen.getByText('新建一本书')).toBeTruthy()
    expect(screen.getByText('扫描 novels/')).toBeTruthy()
  })

  it('opens book workspace from library', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('雾港疑局'))
    await waitFor(() => expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/books/book-1'))
  })
})
