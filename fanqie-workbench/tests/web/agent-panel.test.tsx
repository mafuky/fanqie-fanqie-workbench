import { render, screen, act, cleanup } from '@testing-library/react'
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
afterEach(() => { FakeSocket.last = null; cleanup() })

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

  it('renders streaming text content via delta events', async () => {
    render(<AgentPanel sessionId="s1" />)
    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'phase-start', phase: 'load-context' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'delta', phase: 'load-context', content: '正在' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'delta', phase: 'load-context', content: '加载' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'delta', phase: 'load-context', content: '上下文' }) })
    })
    expect(screen.getByText(/正在加载上下文/)).toBeTruthy()
  })

  it('renders streaming tool call arguments via tool-call-delta events', async () => {
    render(<AgentPanel sessionId="s1" />)
    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'phase-start', phase: 'write-chapter' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'tool-call-delta', phase: 'write-chapter', toolCallIndex: 0, id: 'call_1', name: 'write_file' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'tool-call-delta', phase: 'write-chapter', toolCallIndex: 0, argsFragment: '{"path":"a.md","content":"主角' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'tool-call-delta', phase: 'write-chapter', toolCallIndex: 0, argsFragment: '醒来于医院"}' }) })
    })
    // The accumulating args should appear in the rendered output
    expect(screen.getByText(/write_file/)).toBeTruthy()
    expect(screen.getByText(/主角醒来于医院/)).toBeTruthy()
  })

  it('replaces streaming buffer when final message arrives', async () => {
    render(<AgentPanel sessionId="s1" />)
    await act(async () => {
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'phase-start', phase: 'load-context' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'delta', phase: 'load-context', content: 'partial' }) })
      FakeSocket.last?.fire('message', { data: JSON.stringify({ type: 'message', phase: 'load-context', role: 'assistant', content: 'final complete text' }) })
    })
    expect(screen.queryByText(/partial/)).toBeNull()
    expect(screen.getByText(/final complete text/)).toBeTruthy()
  })
})
