import type { Phase } from './phase.js'

export const reviewChapterPhase: Phase = {
  name: 'review-chapter',
  tools: ['read_file', 'list_dir'],
  maxIterations: 4,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文长篇写作助手，正在对《${ctx.bookMeta.title}》第${chapter.chapterNumber}章「${chapter.title}」进行质量审查。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${chapter.sourcePath}`,
      ``,
      `职责：`,
      `1. 用 read_file 读当前正文 ${chapter.sourcePath}。`,
      `2. 用 read_file 读 追踪/上下文.md，检查人物状态与设定一致性。`,
      `3. 从以下角度审查：`,
      `   - 文字质量：表述清晰、描写生动、节奏合理`,
      `   - 情节连贯：与上下文衔接自然、剧情逻辑严密`,
      `   - 人物一致：人物性格、言行符合设定`,
      `   - 内容合规：无明显违规内容`,
      `4. 给出审查反馈与改进建议。`,
      `5. 不要修改原文，仅提供评审意见。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return [
      `上下文摘要：`,
      String(ctx.previousPhaseResults.contextSummary ?? ''),
      ``,
      `请审查第${chapter.chapterNumber}章，提供质量评估和改进建议。`,
    ].join('\n')
  },
  async onComplete(_ctx, result) {
    return { reviewNotes: result.content }
  },
}
