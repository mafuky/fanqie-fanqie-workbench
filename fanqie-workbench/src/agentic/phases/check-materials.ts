import type { Phase } from './phase.js'

export const checkMaterialsPhase: Phase = {
  name: 'check-materials',
  tools: ['read_file', 'list_dir', 'ask_user'],
  maxIterations: 6,
  systemPrompt(ctx) {
    return [
      `你正在为《${ctx.bookMeta.title}》第${ctx.chapter.chapterNumber}章做写前材料检查。`,
      `bookRoot = ${ctx.bookRoot}`,
      ``,
      `硬阻塞（缺失则必须 ask_user 让用户决定）：`,
      `- 本章细纲文件`,
      `- 章节文件 sourcePath 对应目录`,
      ``,
      `软提醒（缺失只记录，不阻塞）：`,
      `- 对标资料`,
      `- 参考资料`,
      `- 关键角色设定`,
      ``,
      `输出：一段材料齐备/缺失情况的简短报告。若硬阻塞缺失且 ask_user 拿到答复，应在报告里写明用户决定。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const summary = String(ctx.previousPhaseResults.contextSummary ?? '')
    return [
      `上一阶段加载的上下文摘要：`,
      summary,
      ``,
      `请检查写本章所需材料是否齐备。`,
    ].join('\n')
  },
  async onComplete(_ctx, result) {
    return { materialsReport: result.content }
  },
}
