import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewCheckpointCard } from '../../src/web/components/review-checkpoint-card.js'

describe('ReviewCheckpointCard', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/sessions/session-1/review-checkpoint') {
        return {
          ok: true,
          json: async () => ({
            checkpoint: {
              id: 'checkpoint-1',
              title: '第 1 章正文已完成',
              summary: {
                completed: ['章节正文已生成或更新', '追踪文件已按写作流程更新'],
                checks: ['请在左侧编辑器中验收正文质量'],
              },
              changedFiles: ['正文/第001章_雾夜失踪.md', '追踪/伏笔.md'],
              options: ['accept', 'deslop', 'rewrite', 'continue-next', 'save-only'],
              status: 'pending',
            },
          }),
        }
      }
      if (input === '/api/review-checkpoints/checkpoint-1/resolve' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ checkpoint: { id: 'checkpoint-1', status: 'accepted' } }) }
      }
      return { ok: false, json: async () => ({ error: `unexpected fetch: ${input}` }) }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders checkpoint details and resolves accept', async () => {
    const onResolved = vi.fn()
    render(<ReviewCheckpointCard sessionId="session-1" sessionStatus="waiting-review" onResolved={onResolved} />)

    expect(await screen.findByText('第 1 章正文已完成')).toBeTruthy()
    expect(screen.getByText('章节正文已生成或更新')).toBeTruthy()
    expect(screen.getByText('正文/第001章_雾夜失踪.md')).toBeTruthy()

    fireEvent.click(screen.getByText('接受'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/review-checkpoints/checkpoint-1/resolve', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'accept', comment: '' }),
      }))
      expect(onResolved).toHaveBeenCalled()
    })
  })

  it('keeps card visible and shows error when resolve fails', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/sessions/session-1/review-checkpoint') {
        return {
          ok: true,
          json: async () => ({
            checkpoint: {
              id: 'checkpoint-1',
              title: '第 1 章正文已完成',
              summary: { completed: ['章节正文已生成或更新'], checks: [] },
              changedFiles: [],
              options: ['continue-next'],
              status: 'pending',
            },
          }),
        }
      }
      if (input === '/api/review-checkpoints/checkpoint-1/resolve' && init?.method === 'POST') {
        return { ok: false, json: async () => ({ error: '没有下一章，请先创建章节或选择其他操作' }) }
      }
      return { ok: false, json: async () => ({ error: 'unexpected fetch' }) }
    })

    render(<ReviewCheckpointCard sessionId="session-1" sessionStatus="waiting-review" />)
    fireEvent.click(await screen.findByText('继续下一章'))

    expect(await screen.findByText('没有下一章，请先创建章节或选择其他操作')).toBeTruthy()
    expect(screen.getByText('第 1 章正文已完成')).toBeTruthy()
  })

  it('does not render while a conversational answer is pending', async () => {
    render(<ReviewCheckpointCard sessionId="session-1" sessionStatus="waiting-answer" />)

    await waitFor(() => {
      expect((globalThis as any).fetch).not.toHaveBeenCalled()
    })
    expect(screen.queryByText('第 1 章正文已完成')).toBeNull()
  })
})
