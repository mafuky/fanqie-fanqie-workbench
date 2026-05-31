import type { Phase } from './phase.js'

export const deslopChapterPhase: Phase = {
  name: 'deslop-chapter',
  tools: ['read_file', 'write_file'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文长篇AI写作助手，正在为《${ctx.bookMeta.title}》第${chapter.chapterNumber}章「${chapter.title}」进行降评级处理（deslop）。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${chapter.sourcePath}`,
      ``,
      `职责：`,
      `1. 用 read_file 读当前正文 ${chapter.sourcePath}。`,
      `2. 用 read_file 读 追踪/上下文.md，保持人物状态与设定一致。`,
      `3. 识别章节中可能存在的过度描写、不当表述、或审查风险的内容。`,
      `4. 进行适度的文字精简和调整，保留故事核心和情感，提升内容合规性。`,
      `5. 确保修改后的文本在质量、可读性和适宜性之间达到平衡。`,
      `6. 最后用 write_file 工具把处理后的完整正文覆盖写回 ${chapter.sourcePath}。`,
      `7. 不要 ask_user，所有决定独立做。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return [
      `上下文摘要：`,
      String(ctx.previousPhaseResults.contextSummary ?? ''),
      ``,
      `请对第${chapter.chapterNumber}章进行降评级处理，完成后用 write_file 覆盖写入 ${chapter.sourcePath}。`,
    ].join('\n')
  },
  async onComplete(_ctx, _result) {
    return { deslopped: true }
  },
}
