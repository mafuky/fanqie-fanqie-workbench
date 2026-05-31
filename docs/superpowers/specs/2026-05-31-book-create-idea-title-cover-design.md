# 开书想法≠书名 + 书名确认 + 延迟建目录 + 封面按钮 设计

## 背景

`book.create`（开新书）走 agentic 通道（clarify-direction → scaffold-book），但这条流程**从未进过设计文档**——它是在 `2026-05-26-agentic-novel-writer-design.md` 落地后，按「彻底替换 Claude Code 通道」的口径临时加的（BC-1/BC-2）。本文档补齐它，并修正三个实际使用中暴露的问题。

### 当前实现的问题

1. **开书想法被直接当成书名和目录名**。弹窗里「开书想法」框（如「女频豪门追妻火葬场，带悬疑线」）整段被当作 `title`，既建成 `novels/女频豪门追妻火葬场，带悬疑线/`，又显示成书名。想法是创作 brief，不该是书名。
2. **书名没有让用户确认**。用户对最终书名没有控制权。
3. **目录提前创建**。route 一进来就 `mkdir novels/{想法}/`，书名其实是流程中途才该确定的。
4. **没有封面入口**。

### 与 `2026-05-26` spec 的关系

- 原 spec 范围只写了 `chapter.continue`，`book.create` 不在其中——本文档是对该 spec 的**扩展**，不是修订。
- 原 spec「不做」明确：**封面继续走 oh-story-claudecode，跟 agent 无关**。本文档的封面方案（复用 story-cover skill、不进 agent loop）与之一致。

## 范围

### 做

- 开书弹窗：单一「开书想法」输入框（创作 brief），去掉书名输入框
- `book.create` 流程：clarify-direction 末尾让 agent 基于**开书想法 + 题材/平台/篇幅**生成候选书名，用 `ask_user` 让用户确认/修改
- **延迟建目录**：书名确认后才 `mkdir novels/{书名}/`，并回填 books 行的 title + root_path
- 书库每本书一个「生成封面」按钮，复用现有 story-cover skill（项目生成完后可点）

### 不做

- 书名输入框（用户明确否决——书名由想法推导）
- 把封面塞进 agentic 工具链（封面继续走独立 skill 通道）
- 改 `chapter.continue` 流程

## 设计

### A. 开书弹窗 `book-creation-modal.tsx`

- 保留单个 `开书想法` textarea + 常用模板按钮
- 提交 body 从 `{ title: idea }` 改为 `{ idea }`
- modal 标题从 `正在创建《${idea}》` 改为 `正在创建新书…`（书名此时还没定，不能用想法冒充）
- 去掉前端对斜杠/空格的隐含依赖（想法本来就允许逗号空格）

### B. `book.create` 流程：书名在 clarify-direction 末尾确认

`clarify-direction` phase 调整：

- **去掉 `write_file` tool**。clarify 阶段不再往磁盘写任何文件（此时目录还没建）。方向汇总改为只放进 `previousPhaseResults.directionSummary`（内存），由后续 scaffold-book 落盘。
- 必问步骤在原 4 问之后**加第 5 步**：agent 基于「开书想法 + 已问到的题材/平台/篇幅」用 `ask_user` 给出 **3 个候选书名 + 其它(自定义)**，用户选定即为最终书名。
- `onComplete` 返回 `{ directionLocked, directionSummary, bookTitle }`。

system prompt 里把「开书想法」原文透传给 agent（见 D 数据流），让候选书名贴合想法。

### C. 延迟建目录：runner 在 phase 之间回填书名

核心改动是让 runner 支持「clarify-direction 定了书名后，建目录 + 回填 DB + 让后续 phase 用新路径」。

**book 行与目录的生命周期：**

1. route 收到 `{ idea }` → 生成 `bookId`，插入 books 行，`title` 暂存为想法截断的占位值、`root_path` 用**占位值 `pending:{bookId}`**（满足 NOT NULL UNIQUE，且绝不会被当成真实路径写盘）。
2. 启动 agent，`bookMeta = { id, title: 占位, rootPath: 'pending:{bookId}' }`，并向 runner 传入新回调 `onBookNamed`。
3. clarify-direction 跑完，`previousPhaseResults.bookTitle` 有值。runner 检测到「该 phase 产出了 bookTitle 且存在 onBookNamed」→ 调 `onBookNamed(title)`：
   - 计算 `bookRoot = {workspaceRoot}/novels/{title}`
   - 冲突处理：若同名 books 行或目录已存在，追加数字后缀 `（2）`、`（3）`…，并在返回值里带出最终书名
   - `mkdir -p bookRoot`
   - `UPDATE books SET title = ?, root_path = ? WHERE id = ?`
   - **原地修改** `opts.bookMeta.title` 和 `opts.bookMeta.rootPath`
4. 因 runner 每个 phase 都从 `opts.bookMeta.rootPath` 重建 `ctx`（agent-runner.ts:74），且 tool 执行也读 `opts.bookMeta.rootPath`（:112），scaffold-book 自然落到 `novels/{书名}/`。

**runner 接口变更**（`AgentRunnerOptions` / `AgentStartInput`）：

```typescript
// 可选；仅 book.create 传入。其它 action（chapter.continue）不传。
onBookNamed?: (title: string) => Promise<{ title: string; rootPath: string }>
```

runner 在 `phase.onComplete` 合并结果后，检查：
```
if (update?.bookTitle && opts.onBookNamed) {
  const { title, rootPath } = await opts.onBookNamed(update.bookTitle)
  opts.bookMeta.title = title
  opts.bookMeta.rootPath = rootPath
}
```
这是 runner 唯一的 book.create 特例，且通过可选回调隔离，不污染 chapter.continue 路径。

### D. scaffold-book 调整

- 现在由 scaffold-book 负责写 `设定/方向.md`（原来 clarify 写，现已移走）。在原 9 个文件前加一项：`0. 设定/方向.md — 把方向汇总落盘`。
- 数据流：route 把 `idea` 放进 `bookMeta`（新增字段 `idea?: string`）或 `previousPhaseResults`，clarify-direction 的 system prompt 引用它生成贴合的书名与方向。
- 维持之前修复：scaffold-book 写 `正文/第001章.md` 占位，done 后插入 chapter 1 行，`source_path` 用**绝对路径** `join(bookRoot, '正文', '第001章.md')`（已修）。

### E. 封面按钮（独立子系统，不进 agent）

- 书库 `library-page.tsx` 每本书卡片加「生成封面」按钮（与「删除」并列）。
- 点击 → 调用复用现有 **story-cover skill** 的入口（GPT-Image-2，直接出含标题署名的成品图，落到书目录）。
- 触发时机：书的项目已生成完（books 行有真实 root_path）即可点。
- **注意**：story-cover 是 Claude skill 通道，不是 agentic 通道。本次先接「按钮 → 触发已有 skill 入口」的最小闭环；若现有后端没有可复用的 skill 触发入口，封面单列为后续 task，不阻塞 A–D。

## 错误处理

- **书名冲突**：onBookNamed 自动追加后缀，最终书名通过 confirmation/UI 反映，不报错中断。
- **clarify-direction 失败/取消**：因为还没建目录、root_path 仍是 `pending:`，不留任何垃圾目录。需要在 done(failed/cancelled) 时清理这条 books 占位行（避免书库出现一条没目录的幽灵书）。
- **scaffold-book 失败**：目录已建、root_path 已回填，按现有 failed 处理；用户可在书库看到这本半成品书（可删除）。

## 测试策略（沿用 spec 的 TDD discipline）

必须 test-first：

| 模块 | 测试点 |
|---|---|
| `agent-runner.ts` | 传入 `onBookNamed` 时，某 phase 产出 `bookTitle` 后回调被调用、且后续 phase 的 ctx.bookRoot 用上新路径；不传 `onBookNamed` 时（chapter.continue）行为不变 |
| `clarify-direction` | mock provider 喂固定回复，断言第 5 步用 ask_user 问书名、onComplete 产出 bookTitle + directionSummary；不再调 write_file |
| route `/book-create` | body `{ idea }`；建占位 books 行（root_path=`pending:`）；onBookNamed 回调建目录+回填+冲突加后缀；failed/cancelled 清理占位行 |
| `book-creation-modal.tsx` | 只有一个想法框、提交 `{ idea }`、modal 标题不含想法冒充书名 |
| `library-page.tsx` | 每本书渲染「生成封面」按钮、点击触发对应请求 |

不强制 TDD：候选书名/方向/正文等 LLM 输出质量，人工 eval。

## 验收标准

- 浏览器：新建书 → 只填想法 → 依次回答题材/平台/篇幅 → **弹出候选书名让我确认** → 确认后才出现 `novels/{书名}/` → scaffold 完成 → 书库显示**确认的书名**（不是想法原文）→ 打开书能看到第一章 → 「继续写本章」可用
- 取消在书名确认前：书库不留幽灵书、磁盘不留空目录
- 书库每本书有「生成封面」按钮，点击能触发封面生成（或最小闭环）
- `npm test` 不回归
