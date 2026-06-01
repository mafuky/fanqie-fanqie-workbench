import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BookCreationModal } from '../../src/web/components/book-creation-modal.js'

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

describe('BookCreationModal', () => {
  beforeEach(() => {
    FakeSocket.last = null
    ;(globalThis as any).WebSocket = FakeSocket as any
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts { idea } (not { title }) on submit', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/agent-sessions/book-create' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ sessionId: 'sess-1', bookId: 'b-1', status: 'running', traceId: 't-1' }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<BookCreationModal open onClose={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/agent-sessions/book-create', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ idea: '现代悬疑复仇文，强反转' }),
      }))
    })
  })

  it('running modal title is 正在创建新书… and does not reuse the idea as a title', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sessionId: 'sess-1', bookId: 'b-1', status: 'running', traceId: 't-1' }),
    }))

    render(<BookCreationModal open onClose={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('开书想法'), { target: { value: '现代悬疑复仇文，强反转' } })
    fireEvent.click(screen.getByText('开始生成'))

    expect(await screen.findByRole('heading', { name: '正在创建新书…' })).toBeTruthy()
    expect(screen.queryByText(/正在创建《现代悬疑复仇文，强反转》/)).toBeNull()
  })
})
