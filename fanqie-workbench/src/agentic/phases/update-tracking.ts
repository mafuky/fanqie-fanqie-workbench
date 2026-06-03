import type { Phase } from './phase.js'

export const updateTrackingPhase: Phase = {
  name: 'update-tracking',
  tools: ['read_file', 'update_tracking'],
  maxIterations: 8,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你刚写完《${ctx.bookMeta.title}》第${chapter.chapterNumber}章，现在维护追踪文件。`,
      `bookRoot = ${ctx.bookRoot}`,
      ``,
      `操作：`,
      `1. 用 read_file 读 ${chapter.sourcePath} 拿到本章正文。`,
      `2. 用 read_file 读 追踪/上下文.md、追踪/伏笔.md、追踪/时间线.md、追踪/角色状态.md 的当前内容（若文件不存在也继续）。`,
      `3. 用 update_tracking 更新这四个文件：`,
      `   - 上下文：追加/修改本章新发生的剧情、角色状态变化、关键关系。`,
      `   - 伏笔：标记本章新设的伏笔（status=open）和已回收的伏笔（status=closed）。`,
      `   - 时间线：补本章新增的时间节点。`,
      `   - 角色状态：只改每个出场角色的「当前掌握的信息 / 进度」——把本章里"谁又知道了什么、谁误会了什么、读者此刻以为什么"写进去。`,
      `4. 角色状态的红线：「真实身份 / 动机（藏的底）」一节除非本章正文已经正式揭示，否则原样保留，绝不提前泄底；「公开身份 / 读者认知」只在本章确实改变读者认知时才动。`,
      `5. 每个 update_tracking 都是整文件覆盖写，必须把已有内容合并进去再写回，不要丢掉其他角色或其他章节已记录的内容。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return `请基于第${chapter.chapterNumber}章的新正文，更新四份追踪文件（含角色状态的"当前掌握信息/进度"）。`
  },
  async onComplete(_ctx, _result) {
    return { trackingUpdated: true }
  },
}
