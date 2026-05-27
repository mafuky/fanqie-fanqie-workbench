import type { Phase } from './phase.js'

export const loadContextPhase: Phase = {
  name: 'load-context',
  tools: ['read_file', 'list_dir', 'grep'],
  maxIterations: 8,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文长篇写作助手，正在为《${ctx.bookMeta.title}》准备第${chapter.chapterNumber}章「${chapter.title}」的上下文。`,
      `bookRoot = ${ctx.bookRoot}`,
      ``,
      `职责：`,
      `1. 用 list_dir 查看 设定/、大纲/、追踪/ 目录。`,
      `2. 用 read_file 读取本章细纲（如 大纲/细纲_第${String(chapter.chapterNumber).padStart(3, '0')}章.md）。`,
      `3. 读取上一章正文，掌握衔接点。`,
      `4. 读取 追踪/上下文.md、追踪/伏笔.md、追踪/时间线.md（如果存在）。`,
      `5. 不写文件，只 read。`,
      ``,
      `输出：一段不超过 800 字的上下文摘要，覆盖：本章应承接的剧情、关键角色当前状态、需要回收/铺设的伏笔、本章主要节奏目标。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return `请加载第${chapter.chapterNumber}章「${chapter.title}」需要的上下文，最后输出摘要。`
  },
  async onComplete(_ctx, result) {
    return { contextSummary: result.content }
  },
}
