import { render, screen, act } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AgentPanel } from '../../src/web/components/agent-panel.js'

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

beforeAll(() => { (global as any).WebSocket = FakeSocket })
afterEach(() => { FakeSocket.last = null })

describe('AgentPanel', () => {
  it('renders phase progression', async () => {
    render(<AgentPanel sessionId="s1" />)
    await act(async () => {
      FakeSocket.last?.fire('open', {})
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'history', events: [] }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'phase-start', phase: 'load-context' }) })
    })
    expect(screen.getByText(/load-context/)).toBeTruthy()
  })

  it('renders tool calls under their phase', async () => {
    render(<AgentPanel sessionId="s1" />)
    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'phase-start', phase: 'write-chapter' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'tool-call', phase: 'write-chapter', toolCallId: 't1', name: 'write_file', args: { path: 'a.md' } }) })
    })
    expect(screen.getByText(/write_file/)).toBeTruthy()
  })

  it('shows question card and POSTs answer on click', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as any)
    render(<AgentPanel sessionId="s9" />)
    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'question', question: '继续吗？', options: [{ label: '继续' }, { label: '终止' }], multiSelect: false }) })
    })
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.click(screen.getByText('继续'))
    expect(fetchSpy).toHaveBeenCalledWith('/api/agent-sessions/s9/answer', expect.objectContaining({ method: 'POST' }))
  })
})
