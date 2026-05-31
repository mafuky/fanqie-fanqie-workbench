import { join } from 'node:path'
import type { Phase } from './phase.js'

export const writeOutlinePhase: Phase = {
  name: 'write-outline',
  tools: ['read_file', 'list_dir', 'write_file'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    const nnn = String(chapter.chapterNumber).padStart(3, '0')
    const outlinePath = join(ctx.bookRoot, '大纲', `细纲_第${nnn}章.md`)
    return [
      `你是网文长篇写作助手，正在为《${ctx.bookMeta.title}》编排第${chapter.chapterNumber}章「${chapter.title}」的细纲（剧本）。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${outlinePath}`,
      ``,
      `职责：`,
      `1. 用 list_dir 查看 设定/、大纲/、追踪/ 目录。`,
      `2. 用 read_file 读取 设定/ 下相关设定、大纲/总纲.md、追踪/上下文.md。`,
      `3. 读取上一章正文，确认本章应承接的剧情与衔接点。`,
      `4. 为第${chapter.chapterNumber}章写细纲，覆盖：场景设定、出场人物、关键事件、信息揭示、章末钩子。`,
      `5. 篇幅 300-500 字，可执行、具体，不要空话。`,
      `6. 最后用 write_file 工具把细纲写到 ${outlinePath}。`,
      `7. 不要 ask_user，所有决定独立做。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    const nnn = String(chapter.chapterNumber).padStart(3, '0')
    const outlinePath = join(ctx.bookRoot, '大纲', `细纲_第${nnn}章.md`)
    return [
      `上下文摘要：`,
      String(ctx.previousPhaseResults.contextSummary ?? ''),
      ``,
      `请编排第${chapter.chapterNumber}章细纲，写完后用 write_file 写入 ${outlinePath}。`,
    ].join('\n')
  },
  async onComplete(_ctx, _result) {
    return { outlineWritten: true }
  },
}
