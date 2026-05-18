import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AccountsPage } from '../../src/web/pages/accounts-page.js'
import { BooksPage } from '../../src/web/pages/books-page.js'

const toastStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../../src/web/components/ui/toast.js', () => ({
  useToast: () => toastStub,
  ToastProvider: ({ children }: any) => children,
}))

class MockEventSource {
  url: string
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
  }
  addEventListener() {}
  close() {}
}

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  }
}

describe('multi-platform workbench UI', () => {
  beforeEach(() => {
    ;(globalThis as any).EventSource = MockEventSource as any
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    localStorage.clear()
    toastStub.success.mockReset()
    toastStub.error.mockReset()
    toastStub.info.mockReset()
  })

  it('uses DELETE for account removal and surfaces non-OK account failures without success toasts', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/platform-accounts?platform=fanqie') {
        return jsonResponse({
          accounts: [
            {
              id: 'acc-fq-1',
              platform: 'fanqie',
              label: '番茄主号',
              status: 'needs-login',
              lastCheckedAt: null,
              createdAt: '2026-05-13T10:00:00.000Z',
            },
          ],
        })
      }

      if (input === '/api/platform-accounts/acc-fq-1' && init?.method === 'DELETE') {
        return jsonResponse({ error: '删除失败' }, { ok: false, status: 500 })
      }

      if (input === '/api/platform-accounts/acc-fq-1/login-session' && init?.method === 'POST') {
        return jsonResponse({ error: '登录失败' }, { ok: false, status: 500 })
      }

      if (input === '/api/platform-accounts/acc-fq-1/check-health' && init?.method === 'POST') {
        return jsonResponse({ error: '检查失败' }, { ok: false, status: 500 })
      }

      if (input === '/api/platform-accounts' && init?.method === 'POST') {
        return jsonResponse({ error: '添加失败' }, { ok: false, status: 500 })
      }

      throw new Error(`Unexpected fetch: ${input}`)
    })

    ;(globalThis as any).fetch = fetchMock

    render(<AccountsPage />)

    expect(await screen.findByText('番茄主号')).toBeTruthy()

    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[1])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/platform-accounts/acc-fq-1', expect.objectContaining({ method: 'DELETE' }))
    })
    expect(toastStub.error).toHaveBeenCalledWith('删除失败')
    expect(toastStub.success).not.toHaveBeenCalledWith('账号已删除')

    fireEvent.click(screen.getByText('登录'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/platform-accounts/acc-fq-1/login-session', expect.objectContaining({ method: 'POST' }))
    })
    expect(toastStub.error).toHaveBeenCalledWith('登录失败')
    expect(toastStub.success).not.toHaveBeenCalledWith('已发起登录')

    fireEvent.click(screen.getByText('检查'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/platform-accounts/acc-fq-1/check-health', expect.objectContaining({ method: 'POST' }))
    })
    expect(toastStub.error).toHaveBeenCalledWith('检查失败')

    fireEvent.change(screen.getByPlaceholderText('输入账号标签，如：主号、小号A...'), {
      target: { value: '失败账号' },
    })
    fireEvent.click(screen.getByText('+ 添加账号'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/platform-accounts', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ platform: 'fanqie', label: '失败账号' }),
      }))
    })
    expect(toastStub.error).toHaveBeenCalledWith('添加失败')
    expect(toastStub.success).not.toHaveBeenCalledWith('账号已添加')
  })

  it('loads platform accounts, switches tabs with a single fetch, creates accounts, and logs in without legacy capture-session', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/platform-accounts?platform=fanqie') {
        return jsonResponse({
          accounts: [
            {
              id: 'acc-fq-1',
              platform: 'fanqie',
              label: '番茄主号',
              status: 'needs-login',
              lastCheckedAt: null,
              createdAt: '2026-05-13T10:00:00.000Z',
            },
          ],
        })
      }

      if (input === '/api/platform-accounts?platform=qimao') {
        return jsonResponse({
          accounts: [
            {
              id: 'acc-qm-1',
              platform: 'qimao',
              label: '七猫分号',
              status: 'active',
              lastCheckedAt: '2026-05-13T10:10:00.000Z',
              createdAt: '2026-05-13T10:00:00.000Z',
            },
          ],
        })
      }

      if (input === '/api/platform-accounts' && init?.method === 'POST') {
        return jsonResponse({
          id: 'acc-fq-2',
          platform: 'fanqie',
          label: '新增番茄号',
          status: 'needs-login',
          lastCheckedAt: null,
          createdAt: '2026-05-13T11:00:00.000Z',
        }, { status: 201 })
      }

      if (input === '/api/platform-accounts/acc-fq-1/login-session' && init?.method === 'POST') {
        return jsonResponse({ accountId: 'acc-fq-1', status: 'not-wired' }, { status: 202 })
      }

      if (input === '/api/platform-accounts/acc-fq-1/check-health' && init?.method === 'POST') {
        return jsonResponse({ accountId: 'acc-fq-1', checked: false, status: 'needs-login' })
      }

      throw new Error(`Unexpected fetch: ${input}`)
    })

    ;(globalThis as any).fetch = fetchMock

    render(<AccountsPage />)

    expect(await screen.findByText('番茄主号')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/platform-accounts?platform=fanqie')
    expect(screen.getByRole('button', { name: /番茄|番茄小说/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /七猫|七猫小说/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /起点|起点中文网/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /七猫|七猫小说/ }))
    expect(await screen.findByText('七猫分号')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/platform-accounts?platform=qimao')
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-accounts?platform=qimao')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /番茄|番茄小说/ }))
    expect(await screen.findByText('番茄主号')).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/platform-accounts?platform=fanqie')).toHaveLength(2)

    fireEvent.change(screen.getByPlaceholderText('输入账号标签，如：主号、小号A...'), {
      target: { value: '新增番茄号' },
    })
    fireEvent.click(screen.getByText('+ 添加账号'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/platform-accounts', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ platform: 'fanqie', label: '新增番茄号' }),
      }))
    })

    fireEvent.click(screen.getByText('登录'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/platform-accounts/acc-fq-1/login-session', expect.objectContaining({
        method: 'POST',
      }))
    })

    fireEvent.click(screen.getByText('检查'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/platform-accounts/acc-fq-1/check-health', expect.objectContaining({
        method: 'POST',
      }))
    })

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(calledUrls).not.toContain('/api/accounts/acc-fq-1/capture-session')
  })

  it('ignores stale account responses after switching platform tabs', async () => {
    let resolveFanqie: ((response: ReturnType<typeof jsonResponse>) => void) | null = null
    const fanqieResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
      resolveFanqie = resolve
    })

    const fetchMock = vi.fn(async (input: string) => {
      if (input === '/api/platform-accounts?platform=fanqie') {
        return fanqieResponse
      }

      if (input === '/api/platform-accounts?platform=qimao') {
        return jsonResponse({
          accounts: [
            {
              id: 'acc-qm-1',
              platform: 'qimao',
              label: '七猫分号',
              status: 'active',
              lastCheckedAt: null,
              createdAt: '2026-05-13T10:00:00.000Z',
            },
          ],
        })
      }

      throw new Error(`Unexpected fetch: ${input}`)
    })

    ;(globalThis as any).fetch = fetchMock

    render(<AccountsPage />)
    fireEvent.click(screen.getByRole('button', { name: /七猫|七猫小说/ }))

    expect(await screen.findByText('七猫分号')).toBeTruthy()

    resolveFanqie?.(jsonResponse({
      accounts: [
        {
          id: 'acc-fq-1',
          platform: 'fanqie',
          label: '番茄迟到响应',
          status: 'needs-login',
          lastCheckedAt: null,
          createdAt: '2026-05-13T10:00:00.000Z',
        },
      ],
    }))

    await waitFor(() => {
      expect(screen.queryByText('番茄迟到响应')).toBeNull()
    })
    expect(screen.getByText('七猫分号')).toBeTruthy()
  })

  it('loads and renders publication summaries, fetches both book and publication endpoints, and handles publication actions', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books') {
        return jsonResponse({
          books: [
            { id: 'book-1', title: '雾港疑局', root_path: '/tmp/book-1', account_id: null },
          ],
        })
      }

      if (input === '/api/books/book-1') {
        return jsonResponse({
          book: { id: 'book-1', title: '雾港疑局' },
          chapters: [
            { id: 'ch-1', chapter_number: 1, title: '雾夜失踪', stage: '可发布' },
          ],
          summary: {
            totalChapters: 1,
            byStage: { '待写作': 0, '已初稿': 0, '已去AI': 0, '已审稿': 0, '可发布': 1, '发布中': 0, '已发布': 0 },
            publishableCount: 1,
            activeSessionId: null,
            activeChapterId: null,
          },
        })
      }

      if (input === '/api/books/book-1/sessions') {
        return jsonResponse({ sessions: [] })
      }

      if (input === '/api/books/book-1/publications') {
        return jsonResponse({
          publications: [
            {
              id: 'pub-1',
              bookId: 'book-1',
              platform: 'fanqie',
              platformAccountId: 'acc-fq-1',
              platformBookId: 'fq-book-9',
              status: 'bound',
              createdAt: '2026-05-13T10:00:00.000Z',
              updatedAt: '2026-05-13T10:10:00.000Z',
              account: {
                id: 'acc-fq-1',
                label: '番茄主号',
                status: 'active',
              },
              chapterStatusCounts: {
                pending: 1,
                synced: 2,
                published: 3,
                failed: 4,
              },
              latestPublishedAt: '2026-05-13T11:00:00.000Z',
              canPublish: true,
            },
          ],
        })
      }

      if (input === '/api/platform-accounts?platform=fanqie') {
        return jsonResponse({
          accounts: [
            {
              id: 'acc-fq-1',
              platform: 'fanqie',
              label: '番茄主号',
              status: 'active',
              lastCheckedAt: '2026-05-13T11:05:00.000Z',
              createdAt: '2026-05-13T10:00:00.000Z',
            },
          ],
        })
      }

      if (input === '/api/book-publications/pub-1/publish-chapters' && init?.method === 'POST') {
        return jsonResponse({ publicationId: 'pub-1', status: 'not-wired', action: 'publish-chapters' }, { ok: false, status: 501 })
      }

      if (input === '/api/book-publications/pub-1/verify-chapters' && init?.method === 'POST') {
        return jsonResponse({ publicationId: 'pub-1', status: 'not-wired', action: 'verify-chapters' }, { ok: false, status: 501 })
      }

      throw new Error(`Unexpected fetch: ${input}`)
    })

    ;(globalThis as any).fetch = fetchMock

    render(<BooksPage />)

    expect(await screen.findByText('雾港疑局')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1')
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book-1/publications')
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/books/book-1')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/books/book-1/publications')).toHaveLength(1)

    fireEvent.click((await screen.findAllByText('雾港疑局'))[0])

    expect(await screen.findByText('发布平台')).toBeTruthy()
    expect(await screen.findByText((content) => content.includes('账号：番茄主号'))).toBeTruthy()
    expect(await screen.findByText((content) => content.includes('平台书籍：fq-book-9'))).toBeTruthy()
    expect(await screen.findByText('待处理 1')).toBeTruthy()
    expect(await screen.findByText('已同步 2')).toBeTruthy()
    expect(await screen.findByText('已发布 3')).toBeTruthy()
    expect(await screen.findByText('失败 4')).toBeTruthy()

    fireEvent.click(screen.getByText('发布章节'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/book-publications/pub-1/publish-chapters', expect.objectContaining({
        method: 'POST',
      }))
    })
    expect(toastStub.info).toHaveBeenCalledWith('发布章节功能暂未接线')

    fireEvent.click(screen.getByText('校验章节'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/book-publications/pub-1/verify-chapters', expect.objectContaining({
        method: 'POST',
      }))
    })
    expect(toastStub.info).toHaveBeenCalledWith('校验章节功能暂未接线')
  })
})
