import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PromptPage } from '../../src/web/pages/prompt-page.js'

vi.mock('../../src/web/components/ui/toast.js', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  ToastProvider: ({ children }: any) => children,
}))

class MockEventSource {
  url: string
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) { this.url = url }
  addEventListener() {}
  close() {}
}

describe('PromptPage session recovery', () => {
  beforeEach(() => {
    ;(globalThis as any).EventSource = MockEventSource as any
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('loads prompt session history from /api/sessions', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/sessions?kind=prompt') {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              {
                id: 'session-1',
                kind: 'prompt',
                prompt: '帮我开一本悬疑小说',
                status: 'succeeded',
                createdAt: '2026-05-13T00:00:00.000Z',
              },
            ],
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<PromptPage />)

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions?kind=prompt')
    })
  })

  it('restores last active prompt session from localStorage', async () => {
    localStorage.setItem('fanqie:prompt:active-session', 'session-active')

    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/sessions?kind=prompt') {
        return { ok: true, json: async () => ({ sessions: [] }) }
      }
      if (input === '/api/sessions/session-active') {
        return {
          ok: true,
          json: async () => ({
            session: {
              id: 'session-active',
              kind: 'prompt',
              status: 'running',
              createdAt: '2026-05-13T00:00:00.000Z',
            },
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<PromptPage />)

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions/session-active')
    })
  })
})
