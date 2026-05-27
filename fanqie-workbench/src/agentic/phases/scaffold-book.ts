import type { Phase } from './phase.js'

export const scaffoldBookPhase: Phase = {
  name: 'scaffold-book',
  tools: ['read_file', 'write_file'],
  maxIterations: 12,
  systemPrompt(ctx) {
    return [
      `你正在为《${ctx.bookMeta.title}》搭建初始项目结构。bookRoot = ${ctx.bookRoot}`,
      ``,
      `先 read_file 设定/方向.md 拿到方向。然后依次用 write_file 写以下 7 个文件：`,
      ``,
      `1. 大纲/总纲.md     — 3-5 卷大纲，每卷一段 200 字左右`,
      `2. 设定/世界观.md   — 时代背景、地理、势力、规则（200-400 字）`,
      `3. 设定/角色/主角.md — 主角档案（姓名、年龄、背景、动机、性格、外貌、关键经历），约 300 字`,
      `4. 设定/角色/反派.md — 反派档案（同上），约 200 字`,
      `5. 追踪/上下文.md   — 写：本书开始（无任何已发生剧情）`,
      `6. 追踪/伏笔.md     — 写：伏笔追踪表（空列）`,
      `7. 追踪/时间线.md   — 写：时间线追踪表（空列）`,
      ``,
      `每个文件都必须用 write_file 实际写入。完成后用一句话报告。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    return `根据方向 ${String(ctx.previousPhaseResults.directionSummary ?? '已锁定')}, 开始搭建《${ctx.bookMeta.title}》项目结构。`
  },
  async onComplete() {
    return { scaffolded: true }
  },
}
