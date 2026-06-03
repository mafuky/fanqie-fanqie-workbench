import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cp = {
  id: 'cp1', stage: 'volume-reconcile', title: '第一卷对账',
  summary: { completed: [], checks: [] }, changedFiles: [],
  options: ['apply', 'apply-edited', 'skip'], status: 'pending',
  payload: { volumeKey: '第一卷', proposalText: '## 实际完成 vs 计划偏差(对账)\n- 旧钥匙未回收' },
}

afterEach(() => vi.restoreAllMocks())

describe('ReviewCheckpointCard volume-reconcile', () => {
  it('shows the proposal in an editable textarea and submits editedText on 编辑后应用', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkpoint: cp }) }) // GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkpoint: { ...cp, status: 'accepted' } }) }) // POST
    vi.stubGlobal('fetch', fetchMock)
    const { ReviewCheckpointCard } = await import('../../src/web/components/review-checkpoint-card')
    render(<ReviewCheckpointCard sessionId="se" sessionStatus="succeeded" />)

    const textarea = await screen.findByDisplayValue(/旧钥匙未回收/)
    fireEvent.change(textarea, { target: { value: '## 实际完成 vs 计划偏差(对账)\n- 我改过' } })
    fireEvent.click(screen.getByText('编辑后应用'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')
      expect(post).toBeTruthy()
      const sent = JSON.parse(post![1].body)
      expect(sent.action).toBe('apply-edited')
      expect(sent.editedText).toContain('我改过')
    })
  })
})
