import type { Tool } from './tool.js'

export const RECONCILE_MARKER = '## 实际完成 vs 计划偏差(对账)'
const MIN_PROPOSAL_CHARS = 40

export const proposeVolumeReconcileTool: Tool = {
  spec: {
    name: 'propose_volume_reconcile',
    description: `提议本卷的「计划 vs 实际偏差」对账(append-only,需用户确认)。proposalText 必须以「${RECONCILE_MARKER}」开头的小节,逐条写实质偏差。无实质偏差时不要调用本工具。`,
    parameters: {
      type: 'object',
      properties: {
        volumeKey: { type: 'string', description: '卷标识,如 第一卷' },
        proposalText: { type: 'string', description: `对账正文,含「${RECONCILE_MARKER}」小节` },
        arcNote: { type: 'string', description: '可选;仅当偏差波及全书主线时,给总纲的一句话' },
      },
      required: ['volumeKey', 'proposalText'],
    },
  },
  async execute({ args, ctx }) {
    const volumeKey = typeof args.volumeKey === 'string' ? args.volumeKey.trim() : ''
    const proposalText = typeof args.proposalText === 'string' ? args.proposalText : ''
    const arcNote = typeof args.arcNote === 'string' && args.arcNote.trim() ? args.arcNote.trim() : undefined
    if (!volumeKey) return { ok: false, error: 'volumeKey is required' }
    if (!proposalText.includes(RECONCILE_MARKER)) {
      return { ok: false, error: `proposalText must contain the section marker: ${RECONCILE_MARKER}` }
    }
    if (proposalText.trim().length < MIN_PROPOSAL_CHARS) {
      return { ok: false, error: `proposalText too short (< ${MIN_PROPOSAL_CHARS} chars)` }
    }
    ctx.emit({
      type: 'review-checkpoint-requested',
      stage: 'volume-reconcile',
      payload: { volumeKey, proposalText, ...(arcNote ? { arcNote } : {}) },
    })
    return { ok: true, result: `proposed reconciliation for ${volumeKey}` }
  },
}
