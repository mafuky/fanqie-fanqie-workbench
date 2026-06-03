import { render, screen, act, cleanup } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AgentPanel } from '../../src/web/components/agent-panel.js'

class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 0
  closed = false
  listeners: Record<string, ((e: any) => void)[]> = {}
  constructor(public url: string) { FakeSocket.last = this }
  addEventListener(type: string, cb: (e: any) => void) { (this.listeners[type] ??= []).push(cb) }
  send() {}
  close() { this.closed = true }
  fire(type: string, evt: any) { (this.listeners[type] ?? []).forEach((cb) => cb(evt)) }
}

beforeAll(() => { (global as any).WebSocket = FakeSocket })
afterEach(() => { FakeSocket.last = null; cleanup() })

describe('AgentPanel stale session handling', () => {
  it('on "session not found" it calls onStale and shows a friendly line, not a raw red error', async () => {
    const onStale = vi.fn()
    render(<AgentPanel sessionId="dead" onStale={onStale} />)
    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'error', message: 'session not found' }) })
    })
    expect(onStale).toHaveBeenCalledTimes(1)
    // The raw "session not found" string must NOT be rendered as an error line.
    expect(screen.queryByText('session not found')).toBeNull()
    // A friendly notice is shown instead.
    expect(screen.getByText(/会话已结束/)).toBeTruthy()
  })

  it('does not spam: repeated session-not-found errors call onStale only once', async () => {
    const onStale = vi.fn()
    render(<AgentPanel sessionId="dead" onStale={onStale} />)
    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'error', message: 'session not found' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'error', message: 'session not found' }) })
    })
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it('still renders genuine (non-stale) errors as before', async () => {
    render(<AgentPanel sessionId="s1" />)
    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'error', message: '写作失败：超时' }) })
    })
    expect(screen.getByText(/写作失败：超时/)).toBeTruthy()
  })
})
