import type { Phase } from './phase.js'

export const clarifyDirectionPhase: Phase = {
  name: 'clarify-direction',
  tools: ['ask_user', 'write_file'],
  maxIterations: 12,
  systemPrompt(ctx) {
    return [
      `你正在帮用户开新书《${ctx.bookMeta.title}》。bookRoot = ${ctx.bookRoot}`,
      ``,
      `职责：依次用 ask_user 工具问 4 个核心问题，锁定写作方向。`,
      ``,
      `必问 4 个：`,
      `1. 题材 / 核心梗（豪门追妻、重生复仇、系统流、剑修、悬疑等）`,
      `2. 主投平台（番茄 / 起点 / 七猫 / 晋江 / 知乎短篇）`,
      `3. 篇幅与节奏（短篇 30 章 / 中篇 100-200 章 / 长篇 300+ 章）`,
      `4. 开篇钩子方向 + 主角设定大方向（穿越 / 重生 / 现代 / 古代 + 男频/女频 + 主角性别）`,
      ``,
      `每个问题用 ask_user 给 3-5 个常见选项 + "其它(自定义)"。`,
      ``,
      `4 个都问完后，用 write_file 把汇总写到 设定/方向.md（Markdown，包含 4 个小节）。`,
      `输出：一句确认本章节方向已锁定的简短话。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    return `请开始向用户提问，确定《${ctx.bookMeta.title}》的写作方向。`
  },
  async onComplete(_ctx, result) {
    return { directionLocked: true, directionSummary: result.content }
  },
}
