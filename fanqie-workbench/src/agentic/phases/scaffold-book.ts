import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Phase, PhaseContext } from './phase.js'

async function readBookFile(bookRoot: string, rel: string): Promise<string | null> {
  try {
    return await readFile(join(bookRoot, rel), 'utf8')
  } catch {
    return null
  }
}

/** Can't quality-gate a workspace that isn't on disk (test stubs / pending placeholder). */
async function bookRootIsRealDir(bookRoot: string): Promise<boolean> {
  try {
    return (await stat(bookRoot)).isDirectory()
  } catch {
    return false
  }
}

const GOLDEN_CHAPTERS = [1, 2, 3]

export const scaffoldBookPhase: Phase = {
  name: 'scaffold-book',
  tools: ['read_file', 'write_file'],
  maxIterations: 28,
  systemPrompt(ctx) {
    const summary = String(ctx.previousPhaseResults.directionSummary ?? '（方向汇总缺失，按常识填写）')
    return [
      `你正在为《${ctx.bookMeta.title}》搭建初始项目结构。bookRoot = ${ctx.bookRoot}`,
      ``,
      `先用 write_file 写 设定/方向.md，内容就是下面这段方向汇总（原样落盘，可补全小标题）：`,
      `---`,
      summary,
      `---`,
      ``,
      `然后用 write_file 写以下文件，每个都要写实、写够，不要敷衍：`,
      ``,
      `【题材与全书骨架】`,
      `1. 设定/题材定位.md — 题材类型、核心梗（一句话）、爽点设计、目标读者、对标方向、全书目标情绪。≥400 字。`,
      `2. 大纲/总纲.md — 3-5 卷大纲。先给一个「卷级结构表」（卷次｜卷名｜章节范围｜核心事件一句话｜卷末钩子），再每卷一段 200-300 字说明本卷功能、主要冲突、关键反转。≥800 字。`,
      `3. 大纲/卷纲_第一卷.md — 第一卷卷纲，必须含：本卷目标、爽点节奏（每 N 章一个爽点）、情绪弧线、人物弧线、伏笔布局（埋设章+计划回收章）、本卷至少一个关键反转。≥500 字。`,
      ``,
      `【设定】`,
      `4. 设定/世界观.md — 时代背景、地理、势力、规则（"可能/不可能"的事写明）。≥300 字。`,
      `5. 设定/角色/主角.md — 主角档案：姓名、年龄、背景、核心动机、性格、外貌、关键经历、语言风格。≥300 字。`,
      `6. 设定/角色/反派.md — 反派档案（同上维度）。≥200 字。注意：反派/帮手都要留暗面，不要非黑即白。`,
      `7. 设定/关系.md — 主要角色关系网（谁和谁什么关系、张力来源）。≥150 字。`,
      ``,
      `【追踪（写作命脉，强反转/长线尤其依赖）】`,
      `8. 追踪/上下文.md — 写：本书开始（无任何已发生剧情）。`,
      `9. 追踪/伏笔.md — 伏笔追踪表（表头：ID｜伏笔内容｜埋设章｜计划回收章｜状态｜重要度），并按总纲预先登记 3-6 条已规划的核心伏笔（状态=未埋）。`,
      `10. 追踪/时间线.md — 时间线追踪表（表头：时间节点｜章节｜事件｜涉及人物｜备注），可先空表。`,
      `11. 追踪/角色状态.md — 每个主要角色一节，含：公开身份/读者认知、真实身份/动机（藏的底）、当前掌握的信息/进度。这是反转文防止泄底与断线的关键。≥300 字。`,
      ``,
      `【黄金三章细纲 + 占位正文】`,
      `12-14. 大纲/细纲_第001章.md、第002章.md、第003章.md — 每章细纲必须含：核心事件、章首钩子（选型）、目标情绪、情绪变化（起点→终点）、爽点/情绪节点、章末悬念、涉及角色、字数目标、情节点序列（8-12 个，每点一句）。每章 ≥400 字。`,
      `15. 正文/第001章.md — 仅写占位标题行 \`# 第一章\` 和一行注释 \`<!-- 正文待 agent 续写 -->\`，不要写正文（正文由后续写作阶段产出）。`,
      ``,
      `每个文件都必须用 write_file 实际写入。完成后用一句话报告。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    return `根据方向 ${String(ctx.previousPhaseResults.directionSummary ?? '已锁定')}, 开始搭建《${ctx.bookMeta.title}》项目结构。`
  },
  async verify(ctx: PhaseContext): Promise<string[]> {
    if (!(await bookRootIsRealDir(ctx.bookRoot))) return []
    const issues: string[] = []
    const checks: Array<{ rel: string; min: number; label: string }> = [
      { rel: '设定/题材定位.md', min: 200, label: '题材定位' },
      { rel: '大纲/总纲.md', min: 400, label: '总纲' },
      { rel: '大纲/卷纲_第一卷.md', min: 250, label: '第一卷卷纲' },
      { rel: '设定/世界观.md', min: 150, label: '世界观' },
      { rel: '设定/角色/主角.md', min: 150, label: '主角设定' },
      { rel: '设定/角色/反派.md', min: 100, label: '反派设定' },
      { rel: '设定/关系.md', min: 80, label: '关系网' },
      { rel: '追踪/上下文.md', min: 1, label: '上下文' },
      { rel: '追踪/伏笔.md', min: 1, label: '伏笔表' },
      { rel: '追踪/时间线.md', min: 1, label: '时间线' },
      { rel: '追踪/角色状态.md', min: 150, label: '角色状态' },
    ]
    for (const c of checks) {
      const text = await readBookFile(ctx.bookRoot, c.rel)
      if (text === null) issues.push(`缺少文件 ${c.rel}（${c.label}）`)
      else if (text.trim().length < c.min) {
        issues.push(`${c.rel}（${c.label}）内容过薄，仅 ${text.trim().length} 字，至少需 ${c.min} 字`)
      }
    }
    for (const n of GOLDEN_CHAPTERS) {
      const rel = `大纲/细纲_第${String(n).padStart(3, '0')}章.md`
      const text = await readBookFile(ctx.bookRoot, rel)
      if (text === null) issues.push(`缺少黄金第 ${n} 章细纲 ${rel}`)
      else if (text.trim().length < 300) issues.push(`${rel} 内容过薄（${text.trim().length} 字，至少 300 字）`)
    }
    const body = await readBookFile(ctx.bookRoot, '正文/第001章.md')
    if (body === null) issues.push('缺少 正文/第001章.md 占位文件')
    return issues
  },
  async onComplete() {
    return { scaffolded: true }
  },
}
