import type { Phase } from './phase.js'

export const updateTrackingPhase: Phase = {
  name: 'update-tracking',
  tools: ['read_file', 'update_tracking'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你刚写完《${ctx.bookMeta.title}》第${chapter.chapterNumber}章，现在维护追踪文件。`,
      `bookRoot = ${ctx.bookRoot}`,
      ``,
      `操作：`,
      `1. 用 read_file 读 ${chapter.sourcePath} 拿到本章正文。`,
      `2. 用 read_file 读 追踪/上下文.md、追踪/伏笔.md、追踪/时间线.md 的当前内容（若文件不存在也继续）。`,
      `3. 用 update_tracking 更新这三个文件：`,
      `   - 上下文：追加/修改本章新发生的剧情、角色状态变化、关键关系。`,
      `   - 伏笔：标记本章新设的伏笔（status=open）和已回收的伏笔（status=closed）。`,
      `   - 时间线：补本章新增的时间节点。`,
      `4. 每个 update_tracking 都是整文件覆盖写，必须把已有内容合并进去再写回。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return `请基于第${chapter.chapterNumber}章的新正文，更新三份追踪文件。`
  },
  async onComplete(_ctx, _result) {
    return { trackingUpdated: true }
  },
}
