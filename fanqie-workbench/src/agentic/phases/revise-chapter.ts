import type { Phase } from './phase.js'

export const reviseChapterPhase: Phase = {
  name: 'revise-chapter',
  tools: ['read_file', 'write_file'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文长篇写作助手，正在按用户指令修改《${ctx.bookMeta.title}》第${chapter.chapterNumber}章「${chapter.title}」的正文。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${chapter.sourcePath}`,
      ``,
      `要求：`,
      `1. 先确认用户的改稿指令存在（见下方用户消息）；若指令为空，回复说明缺少指令、不要乱改文件。`,
      `2. 用 read_file 读当前正文 ${chapter.sourcePath}。`,
      `3. 用 read_file 读 追踪/上下文.md，保持人物状态与设定一致。`,
      `4. 严格按指令改写正文，保留未被指令涉及的部分，整体风格自然、避免 AI 套路。`,
      `5. 最后用 write_file 工具把改写后的完整正文覆盖写回 ${chapter.sourcePath}。`,
      `6. 不要 ask_user，所有决定独立做。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    const instruction = String(ctx.previousPhaseResults.reviseInstruction ?? '').trim()
    return [
      `改稿指令：`,
      instruction || '（用户未提供指令，请说明缺少指令而不要修改文件）',
      ``,
      `上下文摘要：`,
      String(ctx.previousPhaseResults.contextSummary ?? ''),
      ``,
      `请按指令修改第${chapter.chapterNumber}章正文，写完后用 write_file 覆盖写入 ${chapter.sourcePath}。`,
    ].join('\n')
  },
  async onComplete(_ctx, _result) {
    return { revised: true }
  },
}
