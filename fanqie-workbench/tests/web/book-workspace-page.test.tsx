import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BookWorkspacePage } from '../../src/web/pages/book-workspace-page.js'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  addEventListener(type: string, cb: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) || []
    list.push(cb)
    this.listeners.set(type, list)
  }
  emit(type: string, data: object) {
    for (const cb of this.listeners.get(type) || []) cb({ data: JSON.stringify(data) } as MessageEvent)
  }
  emitDone(status: string) {
    this.emit('message', { type: 'done', status })
  }
  close() {}
}

const detailWithChapter = (contentTitle = '雾夜失踪') => ({
  book: { id: 'book-1', title: '雾港疑局', root_path: '/tmp/book' },
  chapters: [{ id: 'chapter-1', chapter_number: 1, title: contentTitle, stage: '待写作' }],
  summary: { activeSessionId: null, activeChapterId: null },
})

describe('BookWorkspacePage writing loop', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    ;(globalThis as any).WebSocket = MockWebSocket as any
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows empty chapter recovery and scans chapters', async () => {
    let scanDone = false
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => scanDone ? detailWithChapter() : { book: { id: 'book-1', title: '雾港疑局', root_path: '/tmp/book' }, chapters: [], summary: {} } }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/books/scan' && init?.method === 'POST') { scanDone = true; return { ok: true, json: async () => ({ bookCount: 1, chapterCount: 1 }) } }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<BookWorkspacePage bookId="book-1" />)

    expect(await screen.findByText('未发现章节，请先扫描 novels/ 或确认 正文/*.md 文件存在')).toBeTruthy()
    fireEvent.click(screen.getByText('扫描章节'))
    expect(await screen.findByText('雾夜失踪')).toBeTruthy()
    expect(await screen.findByLabelText('章节正文')).toBeTruthy()
  })

  it('loads real editor, edits, and saves chapter content', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content' && !init) return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      if (input === '/api/chapters/chapter-1/content' && init?.method === 'PUT') return { ok: true, json: async () => ({ saved: true }) }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<BookWorkspacePage bookId="book-1" />)

    const editor = await screen.findByLabelText('章节正文')
    fireEvent.change(editor, { target: { value: '# 第1章 雾夜失踪\n新增内容' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/chapters/chapter-1/content', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: '# 第1章 雾夜失踪\n新增内容' }),
      }))
    })
  })

  it('starts continue action and shows agent-panel, refreshes editor content when session completes', async () => {
    let content = '# 第1章 雾夜失踪'
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content' && !init) return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content }) }
      if (input === '/api/agent-sessions' && init?.method === 'POST') return { ok: true, json: async () => ({ sessionId: 'session-1', status: 'running', traceId: 1 }) }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<BookWorkspacePage bookId="book-1" />)

    expect(await screen.findByDisplayValue('# 第1章 雾夜失踪')).toBeTruthy()
    fireEvent.click(await screen.findByText('继续写本章'))
    expect(await screen.findByTestId('agent-panel')).toBeTruthy()

    content = '# 第1章 雾夜失踪\nClaude 新增正文'
    await waitFor(() => {
      const ws = MockWebSocket.instances.find((instance) => instance.url.includes('/api/agent-sessions/session-1/stream'))
      expect(ws).toBeTruthy()
      ws?.emitDone('succeeded')
    })

    expect(await screen.findByDisplayValue(/Claude 新增正文/)).toBeTruthy()
  })

  it('shows action error when /api/agent-sessions fails', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      if (input === '/api/agent-sessions' && init?.method === 'POST') return { ok: false, json: async () => ({ error: '启动失败' }) }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<BookWorkspacePage bookId="book-1" />)

    fireEvent.click(await screen.findByText('继续写本章'))
    expect(await screen.findByText('启动失败')).toBeTruthy()
  })

  it('refreshes after agent-panel onDone fires', async () => {
    let loadCallCount = 0
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') { loadCallCount += 1; return { ok: true, json: async () => detailWithChapter() } }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      if (input === '/api/agent-sessions' && init?.method === 'POST') return { ok: true, json: async () => ({ sessionId: 'session-1', status: 'running', traceId: 1 }) }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<BookWorkspacePage bookId="book-1" />)

    fireEvent.click(await screen.findByText('继续写本章'))
    const ws = await waitFor(() => {
      const found = MockWebSocket.instances.find((instance) => instance.url.includes('/api/agent-sessions/session-1/stream'))
      expect(found).toBeTruthy()
      return found
    })
    ws?.emitDone('succeeded')

    await waitFor(() => expect(loadCallCount).toBeGreaterThanOrEqual(2))
  })

  it('renders the new chapter action buttons', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      throw new Error(`unexpected fetch ${input}`)
    })
    render(<BookWorkspacePage bookId="book-1" />)
    expect(await screen.findByText('编剧本章')).toBeTruthy()
    expect(screen.getByText('AI 改稿本章')).toBeTruthy()
    expect(screen.getByText('写下一章')).toBeTruthy()
  })

  it('triggers chapter.outline action', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      if (input === '/api/agent-sessions' && init?.method === 'POST') return { ok: true, json: async () => ({ sessionId: 'session-1', status: 'running', traceId: 1 }) }
      throw new Error(`unexpected fetch ${input}`)
    })
    ;(globalThis as any).fetch = fetchMock
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('编剧本章'))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c: any[]) => c[0] === '/api/agent-sessions' && c[1]?.method === 'POST' && JSON.parse(c[1].body).actionKey === 'chapter.outline')
      expect(call).toBeTruthy()
    })
  })

  it('opens an instruction input and submits chapter.revise with instruction', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      if (input === '/api/agent-sessions' && init?.method === 'POST') return { ok: true, json: async () => ({ sessionId: 'session-1', status: 'running', traceId: 1 }) }
      throw new Error(`unexpected fetch ${input}`)
    })
    ;(globalThis as any).fetch = fetchMock
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('AI 改稿本章'))
    const input = await screen.findByPlaceholderText('输入改稿指令，例如：把结尾改得更悬疑') as HTMLInputElement
    fireEvent.change(input, { target: { value: '把男主写得更狠' } })
    fireEvent.click(screen.getByText('提交改稿'))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c: any[]) => c[0] === '/api/agent-sessions' && c[1]?.method === 'POST' && JSON.parse(c[1].body).actionKey === 'chapter.revise')
      expect(call).toBeTruthy()
      expect(JSON.parse(call![1].body).instruction).toBe('把男主写得更狠')
    })
  })

  it('triggers chapter-next endpoint when 写下一章 clicked', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      if (input === '/api/agent-sessions/chapter-next' && init?.method === 'POST') return { ok: true, json: async () => ({ sessionId: 'session-next', chapterId: 'chapter-2', status: 'running', traceId: 2 }) }
      throw new Error(`unexpected fetch ${input}`)
    })
    ;(globalThis as any).fetch = fetchMock
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('写下一章'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/agent-sessions/chapter-next', expect.objectContaining({ method: 'POST' }))
    })
  })

  it('toggles the assets panel and loads the asset tree', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章' }) }
      if (input === '/api/books/book-1/assets') return { ok: true, json: async () => ({ tree: [{ path: '设定', name: '设定', type: 'dir', children: [] }] }) }
      throw new Error(`unexpected fetch ${input}`)
    })
    ;(globalThis as any).fetch = fetchMock
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('资产'))
    expect(await screen.findByText('设定')).toBeTruthy()
  })
})
