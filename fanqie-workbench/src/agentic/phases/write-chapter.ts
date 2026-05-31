import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Phase, PhaseContext } from './phase.js'

const PLACEHOLDER = '<!-- 正文待 agent 续写 -->'
const MIN_CHARS = 1200 // 下限；目标 2500-3500

function resolveChapterPath(ctx: PhaseContext): string {
  const sourcePath = ctx.chapter!.sourcePath
  return isAbsolute(sourcePath) ? sourcePath : join(ctx.bookRoot, sourcePath)
}

/** Can't quality-gate a workspace that isn't on disk (test stubs / pending placeholder). */
async function bookRootIsRealDir(bookRoot: string): Promise<boolean> {
  try {
    return (await stat(bookRoot)).isDirectory()
  } catch {
    return false
  }
}

export const writeChapterPhase: Phase = {
  name: 'write-chapter',
  tools: ['read_file', 'write_file'],
  maxIterations: 8,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    const padded = String(chapter.chapterNumber).padStart(3, '0')
    return [
      `你是网文长篇写作助手，正在为《${ctx.bookMeta.title}》写第${chapter.chapterNumber}章「${chapter.title}」。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${chapter.sourcePath}`,
      ``,
      `【写前必须 read_file 的材料（缺哪个跳过哪个，但本章细纲必须读）】`,
      `1. 大纲/细纲_第${padded}章.md —— 本章细纲，按其情节点序列与钩子设计逐点落实，不得漏埋细纲指定的伏笔。`,
      `2. 上一章正文（大纲/总纲.md 或正文目录里的上一章），掌握衔接点与上一章末钩子。`,
      `3. 追踪/上下文.md、追踪/伏笔.md、追踪/角色状态.md —— 确认"此刻谁知道什么、读者以为什么"，反转文严禁提前泄底。`,
      `4. .claude/agent-memory/narrative-writer/feedback-writing-style.md —— 若存在，严格遵守其中的项目专属风格规范。`,
      ``,
      `【正文硬约束（红线）】`,
      `- 单章字数 2500-3500 字，正文必须实际写够，不能用占位或大纲式罗列充数。`,
      `- 严格承接上一章结尾，与本章细纲一致；细纲要埋的伏笔本章必须埋。`,
      `- 限知视角，不得跳进非视角人物内心（悬疑/反转的信息差靠这个）。`,
      `- 段落短：一句一段，单段尽量不超过 60 字（对话、内心独白除外）。`,
      `- 对话不用"他说""她道"，用动作/神态引出对话。`,
      `- 不堆纯描写：连续不超过 3 段纯描写，描写中穿插动作或对话。`,
      `- 去 AI 味：不要章末升华/总结/哲理收尾；不要"他感到/觉得"直述情绪，用身体反应替代；禁用万能比喻（像潮水般、如闪电般）；禁用词（轻轻、仿佛、犹如、微微、不禁、缓缓、一丝、一抹、在那一刻、不仅…而且、心中暗想）尽量零出现。`,
      `- 章末留钩子（悬念/反转/承上启下）。`,
      ``,
      `最后用 write_file 把完整正文写到 ${chapter.sourcePath}（覆盖占位内容）。不要 ask_user，所有决定独立做。`,
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
      `请先 read_file 本章细纲与追踪文件，再开始写本章正文，写完后用 write_file 写入 ${chapter.sourcePath}。`,
    ].join('\n')
  },
  async verify(ctx: PhaseContext): Promise<string[]> {
    if (!(await bookRootIsRealDir(ctx.bookRoot))) return []
    const issues: string[] = []
    let text: string | null = null
    try {
      text = await readFile(resolveChapterPath(ctx), 'utf8')
    } catch {
      text = null
    }
    if (text === null) {
      issues.push(`正文文件未写入：${ctx.chapter!.sourcePath}`)
      return issues
    }
    const body = text.trim()
    if (body.includes(PLACEHOLDER)) issues.push('正文仍是占位符，未实际写作')
    const charCount = body.replace(/\s/g, '').length
    if (charCount < MIN_CHARS) {
      issues.push(`正文字数不足（约 ${charCount} 字，目标 2500-3500，下限 ${MIN_CHARS}）`)
    }
    return issues
  },
  async onComplete(_ctx, _result) {
    return { written: true }
  },
}
