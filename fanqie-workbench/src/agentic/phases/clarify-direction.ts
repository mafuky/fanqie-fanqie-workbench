import type { Phase } from './phase.js'

/** Parse the confirmed title out of the agent's final message.
 * The agent is instructed to end with a `BOOK_TITLE: <书名>` line after the
 * user picks one of the candidate titles. Falls back to the first non-empty
 * line so the runner always gets a usable name. */
function parseBookTitle(content: string): string {
  const marker = content.match(/BOOK_TITLE:\s*(.+)/i)
  if (marker) {
    return marker[1].trim().replace(/[《》]/g, '').trim()
  }
  const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return (firstLine ?? '新书').replace(/[《》]/g, '').slice(0, 40).trim() || '新书'
}

export const clarifyDirectionPhase: Phase = {
  name: 'clarify-direction',
  tools: ['ask_user'],
  maxIterations: 14,
  systemPrompt(ctx) {
    const idea = ctx.bookMeta.idea ?? '（未提供，向用户确认）'
    return [
      `你正在帮用户开新书。用户的开书想法（创作 brief）是：「${idea}」`,
      `注意：开书想法不是书名，只是方向参考。不要把它当书名。`,
      ``,
      `职责：依次用 ask_user 工具问 5 个问题，锁定写作方向并确认书名。本阶段不写任何文件。`,
      ``,
      `必问 5 个：`,
      `1. 题材 / 核心梗（豪门追妻、重生复仇、系统流、剑修、悬疑等）`,
      `2. 主投平台（番茄 / 起点 / 七猫 / 晋江 / 知乎短篇）`,
      `3. 篇幅与节奏（短篇 30 章 / 中篇 100-200 章 / 长篇 300+ 章）`,
      `4. 开篇钩子方向 + 主角设定大方向（穿越 / 重生 / 现代 / 古代 + 男频/女频 + 主角性别）`,
      `5. 书名确认：基于「开书想法 + 上面问到的题材/平台/篇幅」，用 ask_user 给出 3 个候选书名 + "其它(自定义)"，让用户选定最终书名。`,
      ``,
      `前 4 个问题，每个用 ask_user 给 3-5 个常见选项 + "其它(自定义)"。`,
      ``,
      `5 个都问完后，输出两部分：`,
      `- 一段方向汇总（Markdown，包含 题材/平台/篇幅/钩子 4 个小节），供后续阶段落盘；`,
      `- 最后单独一行：\`BOOK_TITLE: <用户选定的书名>\`（不带书名号）。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const idea = ctx.bookMeta.idea ?? ''
    return `请开始向用户提问，确定写作方向并确认书名。开书想法：「${idea}」。`
  },
  async onComplete(_ctx, result) {
    return {
      directionLocked: true,
      directionSummary: result.content,
      bookTitle: parseBookTitle(result.content),
    }
  },
}
