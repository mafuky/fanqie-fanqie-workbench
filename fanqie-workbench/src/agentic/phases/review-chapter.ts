import type { Phase } from './phase.js'

export const reviewChapterPhase: Phase = {
  name: 'review-chapter',
  tools: ['read_file', 'list_dir'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文审稿助手，正在审查《${ctx.bookMeta.title}》第${chapter.chapterNumber}章「${chapter.title}」。`,
      `bookRoot = ${ctx.bookRoot}`,
      `审查目标文件 = ${chapter.sourcePath}`,
      ``,
      `要求：`,
      `1. 用 read_file 读正文 ${chapter.sourcePath}，必要时用 list_dir / read_file 参考 设定/、大纲/、追踪/。`,
      `2. 只读不写：本阶段不修改任何文件。`,
      `3. 输出一份审查意见，覆盖：剧情连贯性、人设一致性、节奏与爽点、伏笔回收、明显 bug 或硬伤。`,
      `4. 审查意见请直接作为最终回复输出，不要 ask_user。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return `请审查第${chapter.chapterNumber}章正文，输出审查意见。`
  },
  async onComplete(_ctx, result) {
    return { reviewNotes: result.content }
  },
}
