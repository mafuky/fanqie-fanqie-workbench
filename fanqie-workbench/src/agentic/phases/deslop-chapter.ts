import type { Phase } from './phase.js'

export const deslopChapterPhase: Phase = {
  name: 'deslop-chapter',
  tools: ['read_file', 'write_file'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文润色助手，正在为《${ctx.bookMeta.title}》第${chapter.chapterNumber}章「${chapter.title}」去 AI 味。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${chapter.sourcePath}`,
      ``,
      `要求：`,
      `1. 用 read_file 读当前正文 ${chapter.sourcePath}。`,
      `2. 清除模板化、AI 腔的句式（"不仅...而且"、"在那一刻"、"心中暗想"、过度排比与总结句），让文字回归自然口语化的网文叙述。`,
      `3. 只改文风，不改剧情、人物与信息量。`,
      `4. 最后用 write_file 工具把润色后的完整正文覆盖写回 ${chapter.sourcePath}。`,
      `5. 不要 ask_user，所有决定独立做。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return `请对第${chapter.chapterNumber}章正文去 AI 味，写完后用 write_file 覆盖写入 ${chapter.sourcePath}。`
  },
  async onComplete(_ctx, _result) {
    return { deslopped: true }
  },
}
