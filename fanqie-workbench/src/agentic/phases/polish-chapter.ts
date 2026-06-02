import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Phase, PhaseContext } from './phase.js'

const PLACEHOLDER = '<!-- 正文待 agent 续写 -->'
const MIN_CHARS = 1500 // polish must not gut the chapter

function resolveChapterPath(ctx: PhaseContext): string {
  const sourcePath = ctx.chapter!.sourcePath
  return isAbsolute(sourcePath) ? sourcePath : join(ctx.bookRoot, sourcePath)
}

async function bookRootIsRealDir(bookRoot: string): Promise<boolean> {
  try {
    return (await stat(bookRoot)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Second-pass polish for the one-shot writing pipeline. The first pass (write-chapter)
 * tends to over-fragment prose into uniform short paragraphs — which itself reads as
 * "AI". This pass fixes RHYTHM, SUBTEXT and FLAT EMOTION without touching plot/info.
 */
export const polishChapterPhase: Phase = {
  name: 'polish-chapter',
  tools: ['read_file', 'write_file'],
  maxIterations: 4,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    const padded = String(chapter.chapterNumber).padStart(3, '0')
    return [
      `你是网文打磨师，正在为《${ctx.bookMeta.title}》第${chapter.chapterNumber}章「${chapter.title}」做"二次打磨"。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${chapter.sourcePath}`,
      ``,
      `【先 read_file】`,
      `1. ${chapter.sourcePath} —— 刚写好的本章正文（你要打磨的对象）。`,
      `2. 大纲/细纲_第${padded}章.md —— 确认剧情/伏笔/钩子，打磨时一个都不能丢或改。`,
      `3. 追踪/上下文.md —— 保持人设、视角、信息差一致。`,
      ``,
      `【这一遍只改"怎么说"，绝不改"说什么"】剧情、信息、人设、视角、章末钩子、字数规模一律不动。`,
      `要解决的恰恰是初稿最像 AI 的三个毛病：`,
      `- **节奏太碎太均匀**：初稿几乎一句一段，从头到尾一个节奏。把关系紧密的短句并成自然段落，让长短句交替；该快的地方留碎句，该铺陈的地方（场景、心理转折）展开成有呼吸的段落。不要全篇一个节拍。`,
      `- **对话太直白、像审讯**："你到底想干什么""你为什么总跟着我"这种把意图直接喊出来的，改成有潜台词、有回避、有言外之意的对话；用动作/停顿/答非所问承载情绪，别让角色把心理活动说成台词。`,
      `- **情绪扁平**：把"她很紧张/他很生气"这类直述，换成具体的身体反应、下意识动作、环境细节落地；但别堆形容词、别用万能比喻（像潮水般/如闪电般）。`,
      `同时清掉残留套词（仿佛、宛如、不禁、微微、缓缓、一丝、一抹、在那一刻、心中暗想），但**不要为了去套词把句子改得更碎**——这一遍的首要目标是让节奏像人写的。`,
      ``,
      `打磨后字数与初稿相当（2500-3500），不许越改越短、不许删情节。最后用 write_file 覆盖写回 ${chapter.sourcePath}。不要 ask_user。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return [
      `请先 read_file 读本章正文与细纲，再做二次打磨（治节奏过碎、对话太直白、情绪扁平），`,
      `保持剧情与字数规模不变，完成后用 write_file 覆盖写回 ${chapter.sourcePath}。`,
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
    if (body.includes(PLACEHOLDER)) issues.push('正文被打磨成占位符了')
    const charCount = body.replace(/\s/g, '').length
    if (charCount < MIN_CHARS) {
      issues.push(`打磨后字数塌缩（约 ${charCount} 字，应保持 2500-3500，不得越改越短）`)
    }
    return issues
  },
  async onComplete(_ctx, _result) {
    return { polished: true }
  },
}
