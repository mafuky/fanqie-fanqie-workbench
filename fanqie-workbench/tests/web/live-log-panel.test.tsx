import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LiveLogPanel } from '../../src/web/components/live-log-panel.js'

class MockEventSource {
  static instances: MockEventSource[] = []

  url: string
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  listeners = new Map<string, (event: MessageEvent) => void>()
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
    ;(globalThis as any).__lastEventSource = this
  }

  addEventListener(type: string, cb: (event: MessageEvent) => void) {
    this.listeners.set(type, cb)
  }

  emitMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  emitQuestion(data: any) {
    this.listeners.get('question')?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  emitDone(data: any) {
    this.listeners.get('done')?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

describe('LiveLogPanel human-in-the-loop', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    ;(globalThis as any).EventSource = MockEventSource as any
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answered: true }) })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows question UI when SSE emits question event and submits answer', async () => {
    render(<LiveLogPanel taskId="task-1" />)

    const es = (globalThis as any).__lastEventSource as MockEventSource
    es.emitQuestion({
      toolUseId: 'tool-1',
      question: '你想要创作什么题材的小说？',
      options: [
        { label: '悬疑推理', description: '侦探、破案、解谜' },
        { label: '现代言情', description: '都市、职场、恋爱' },
      ],
    })

    expect(await screen.findByText('你想要创作什么题材的小说？')).toBeTruthy()
    expect(screen.getByText('悬疑推理')).toBeTruthy()

    fireEvent.click(screen.getByText('悬疑推理'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/tasks/task-1/answer', expect.objectContaining({
        method: 'POST',
      }))
    })
  })

  it('submits a custom freeform answer when the user types one', async () => {
    render(<LiveLogPanel taskId="task-1" streamBase="sessions" />)

    const es = (globalThis as any).__lastEventSource as MockEventSource
    es.emitQuestion({
      toolUseId: 'tool-1',
      question: '这一章你希望主角先查线索还是先躲避追兵？',
      options: [
        { label: '先查线索', description: '优先推进破案' },
      ],
    })

    expect(await screen.findByText('这一章你希望主角先查线索还是先躲避追兵？')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('输入你的回答…'), {
      target: { value: '先假装撤退，再回头查仓库里的线索。' },
    })
    fireEvent.click(screen.getByText('提交回答'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions/task-1/answer', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ answer: '先假装撤退，再回头查仓库里的线索。' }),
      }))
    })
  })

  it('ignores replayed session messages with the same id', async () => {
    const onChunk = vi.fn()
    render(<LiveLogPanel taskId="task-1" streamBase="sessions" onChunk={onChunk} />)

    const source = MockEventSource.instances[0]
    source.emitMessage({ id: 7, stream: 'stdout', chunk: '重复日志' })
    source.emitMessage({ id: 7, stream: 'stdout', chunk: '重复日志' })

    expect(await screen.findByText('重复日志')).toBeTruthy()
    expect(screen.getAllByText('重复日志')).toHaveLength(1)
    expect(onChunk).toHaveBeenCalledTimes(1)
  })

  it('keeps the same SSE connection when only onDone changes', async () => {
    const firstDone = vi.fn()
    const secondDone = vi.fn()
    const view = render(<LiveLogPanel taskId="task-1" onDone={firstDone} />)

    expect(MockEventSource.instances).toHaveLength(1)
    const source = MockEventSource.instances[0]

    source.emitMessage({ stream: 'stdout', chunk: '第一行日志' })
    expect(await screen.findByText('第一行日志')).toBeTruthy()

    view.rerender(<LiveLogPanel taskId="task-1" onDone={secondDone} />)

    expect(MockEventSource.instances).toHaveLength(1)
    expect(source.close).not.toHaveBeenCalled()
    expect(screen.getByText('第一行日志')).toBeTruthy()

    source.emitDone({ status: 'succeeded' })
    await waitFor(() => {
      expect(firstDone).not.toHaveBeenCalled()
      expect(secondDone).toHaveBeenCalledWith('succeeded')
    })
  })
})
