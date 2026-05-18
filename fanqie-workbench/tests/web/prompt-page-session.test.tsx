import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PromptPage } from '../../src/web/pages/prompt-page.js'

vi.mock('../../src/web/components/ui/toast.js', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  ToastProvider: ({ children }: any) => children,
}))

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  addEventListener() {}
  close() {}
}

describe('PromptPage session model', () => {
  beforeEach(() => {
    ;(globalThis as any).EventSource = MockEventSource as any
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/sessions?kind=prompt') {
        return { ok: true, json: async () => ({ sessions: [] }) }
      }
      return { ok: true, json: async () => ({}) }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('submits a new prompt session through /api/sessions', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/sessions?kind=prompt') {
        return { ok: true, json: async () => ({ sessions: [] }) }
      }
      if (input === '/api/sessions') {
        return {
          ok: true,
          json: async () => ({ session: { id: 'session-1', kind: 'prompt', status: 'running' } }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<PromptPage />)

    const textarea = await screen.findByPlaceholderText(/输入完整提示词|输入你要/i)
    fireEvent.change(textarea, { target: { value: '帮我开一本悬疑小说' } })
    fireEvent.click(screen.getByRole('button', { name: /执行/ }))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
        method: 'POST',
      }))
    })
  })

  it('does not render book-entry sessions in free chat history', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/sessions?kind=prompt') {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              { id: 's1', kind: 'prompt', status: 'succeeded', currentSkill: 'book-entry', pendingQuestionJson: null, createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:01:00.000Z' },
              { id: 's2', kind: 'prompt', status: 'succeeded', currentSkill: 'custom', pendingQuestionJson: null, createdAt: '2026-05-14T00:02:00.000Z', updatedAt: '2026-05-14T00:03:00.000Z' },
            ],
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<PromptPage />)

    fireEvent.click(await screen.findByText(/历史任务/))

    expect(screen.queryByText('Skill: book-entry')).toBeNull()
    expect(await screen.findByText('自由对话会话')).toBeTruthy()
  })
})
