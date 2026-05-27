import type { Phase } from './phase.js'

export const writeChapterPhase: Phase = {
  name: 'write-chapter',
  tools: ['read_file', 'write_file'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文长篇写作助手，正在为《${ctx.bookMeta.title}》写第${chapter.chapterNumber}章「${chapter.title}」。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${chapter.sourcePath}`,
      ``,
      `要求：`,
      `1. 单章字数 2500-3500 字。`,
      `2. 严格承接上一章结尾，与本章细纲保持一致。`,
      `3. 风格自然，避免明显 AI 套路（"不仅...而且"、"在那一刻"、"心中暗想"等模板化句式不要堆叠）。`,
      `4. 章末留下钩子（悬念/反转/承上启下的引子）。`,
      `5. 最后用 write_file 工具把完整正文写到 ${chapter.sourcePath}。`,
      `6. 不要 ask_user，所有决定独立做。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return [
      `上下文摘要：`,
      String(ctx.previousPhaseResults.contextSummary ?? ''),
      ``,
      `材料检查报告：`,
      String(ctx.previousPhaseResults.materialsReport ?? ''),
      ``,
      `请开始写本章正文，写完后用 write_file 写入 ${chapter.sourcePath}。`,
    ].join('\n')
  },
  async onComplete(_ctx, _result) {
    return { written: true }
  },
}
