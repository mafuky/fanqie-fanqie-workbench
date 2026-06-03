import { describe, expect, it, vi } from 'vitest'
import { proposeVolumeReconcileTool } from '../../../src/agentic/tools/propose-volume-reconcile.js'

const MARK = '## 实际完成 vs 计划偏差(对账)'
const ctx = () => ({ bookId: 'b1', bookRoot: '/x', emit: vi.fn() })

describe('propose_volume_reconcile tool', () => {
  it('emits a review-checkpoint-requested event on valid input', async () => {
    const c = ctx()
    const proposalText = `${MARK}\n- 旧钥匙未如期回收\n- 反转提前透了一半`
    const r = await proposeVolumeReconcileTool.execute({
      args: { volumeKey: '第一卷', proposalText, arcNote: '主线略提前' }, ctx: c,
    })
    expect(r.ok).toBe(true)
    expect(c.emit).toHaveBeenCalledWith({
      type: 'review-checkpoint-requested', stage: 'volume-reconcile',
      payload: { volumeKey: '第一卷', proposalText, arcNote: '主线略提前' },
    })
  })

  it('rejects proposalText missing the section marker', async () => {
    const c = ctx()
    const r = await proposeVolumeReconcileTool.execute({ args: { volumeKey: '第一卷', proposalText: '太短没有标题' }, ctx: c })
    expect(r.ok).toBe(false)
    expect(c.emit).not.toHaveBeenCalled()
  })

  it('rejects proposalText below the length floor', async () => {
    const c = ctx()
    const r = await proposeVolumeReconcileTool.execute({ args: { volumeKey: '第一卷', proposalText: MARK }, ctx: c })
    expect(r.ok).toBe(false)
  })

  it('rejects missing volumeKey', async () => {
    const c = ctx()
    const proposalText = `${MARK}\n- 一条足够长的真实偏差记录用于通过长度校验`
    const r = await proposeVolumeReconcileTool.execute({ args: { proposalText }, ctx: c })
    expect(r.ok).toBe(false)
  })
})
