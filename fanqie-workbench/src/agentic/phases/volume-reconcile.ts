import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Phase, PhaseContext } from './phase.js'
import { parseVolumeFileName, parseVolumeChapterRange, findVolumeEndingAt, intToChineseNumeral, type VolumeRange } from '../../domain/volume.js'
import { RECONCILE_MARKER } from '../tools/propose-volume-reconcile.js'

/** Read 大纲/, return every 卷纲_第X卷.md with a parseable 章节范围. Never throws. */
function readVolumeRanges(bookRoot: string): VolumeRange[] {
  try {
    const dir = join(bookRoot, '大纲')
    const out: VolumeRange[] = []
    for (const name of readdirSync(dir)) {
      const volumeNumber = parseVolumeFileName(name)
      if (volumeNumber == null) continue
      const range = parseVolumeChapterRange(readFileSync(join(dir, name), 'utf8'))
      if (range) out.push({ volumeNumber, start: range.start, end: range.end })
    }
    return out
  } catch { return [] }
}

function endingVolume(ctx: PhaseContext): { volumeNumber: number } | null {
  const n = ctx.chapter?.chapterNumber
  if (!n) return null
  return findVolumeEndingAt(n, readVolumeRanges(ctx.bookRoot))
}

export const volumeReconcilePhase: Phase = {
  name: 'volume-reconcile',
  tools: ['read_file', 'list_dir', 'grep', 'propose_volume_reconcile'],
  maxIterations: 6,
  nonFatal: true,
  async shouldRun(ctx) {
    try { return endingVolume(ctx) != null } catch { return false }
  },
  systemPrompt(ctx) {
    const vol = endingVolume(ctx)
    const volNumeral = vol ? intToChineseNumeral(vol.volumeNumber) : ''
    const volLabel = vol ? `第${volNumeral}卷` : '本卷'
    return [
      `《${ctx.bookMeta.title}》刚写完第${ctx.chapter?.chapterNumber}章,这是【${volLabel}】的末章。对该卷做一次「计划 vs 实际」对账。`,
      `bookRoot = ${ctx.bookRoot}`,
      ``,
      `步骤:`,
      `1. 读 大纲/卷纲_第${volNumeral}卷.md 的计划(爽点节奏/伏笔布局/关键反转/情绪弧线/人物弧线/卷末钩子/核心矛盾)。`,
      `2. 读本卷各章的细纲「实际完成情况」(大纲/细纲_第*章.md)+ 追踪/伏笔.md + 追踪/角色状态.md,掌握实际。`,
      `3. 逐维度对照,只挑【实质偏差】:伏笔未如期回收 / 反转提前或推迟 / 卷末钩子是否兑现 / 核心矛盾是否真收束 / 情绪与爽点节奏是否走样。`,
      `4. 若【无实质偏差】(基本按计划完成)——直接说明,【不要调用任何工具】,结束。`,
      `5. 若有偏差——调用 propose_volume_reconcile,proposalText 以「${RECONCILE_MARKER}」开头、逐条列偏差;只有当偏差波及全书主线时才填 arcNote。`,
      `不写任何文件;不要问用户。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const vol = endingVolume(ctx)
    const volNumeral = vol ? intToChineseNumeral(vol.volumeNumber) : ''
    return `请对【第${volNumeral}卷】做计划 vs 实际对账;无实质偏差则不调用工具。`
  },
}
