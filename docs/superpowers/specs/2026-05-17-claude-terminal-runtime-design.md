# Claude 终端运行时设计

## 目标

`fanqie-workbench` 需要在 Web UI 中自动控制真实的 Claude Code 会话，不再使用 `claude -p`，也不要求用户在 Web 和终端之间手动复制命令。

系统继续保留 `oh-story-claudecode` 作为 Claude Code 原生写作引擎。`fanqie-workbench` 负责本地 Web 工作台能力：书籍管理、章节状态、日志、任务调度，以及后续发布上传。

## 非目标

- 不把 `oh-story-claudecode` skills 重写成 Anthropic SDK prompt。
- 不把 `claude -p` 作为执行路径。
- 不要求用户在 Web 和终端之间手动复制/粘贴。
- 不把发布上传作为第一阶段目标；发布上传在写作产物确认后再执行。
- 不支持同一本书的多个任务同时运行。

## 现有贴合度

`fanqie-workbench` 已经具备合适的控制台基础：

- 书籍/章节 React UI：`fanqie-workbench/src/web/pages/books-page.tsx`。
- Session API 和 SSE 日志流：`fanqie-workbench/src/server/routes/sessions.ts`。
- 实时日志和问题回答 UI：`fanqie-workbench/src/web/components/live-log-panel.tsx`。
- SQLite 表：`books`、`chapters`、`sessions`、`session_messages`、`book_publications`、`chapter_publications`。
- 写作基础设施部署：`fanqie-workbench/src/story/story-setup-service.ts`。
- 发布上传骨架：`fanqie-workbench/src/publish/*`。

`oh-story-claudecode` 提供写作引擎：

- `/story-long-write`、`/story-deslop`、`/story-review`、`/story-import`、`/story-cover` 等 skills。
- 用于 hooks、agents、rules、settings 的 `.claude` 模板。
- 基于文件系统的 `novels/<book>/` 书籍结构。
- 通过 Claude Code subagents 执行多 Agent 审稿。

当前缺失的是运行时桥接层：用基于终端的 Claude Code runtime 替换现有 `claude -p` executor。

## 运行时模型

在一个真实终端会话中运行交互式 Claude Code 进程。

推荐第一版实现：

```text
Browser
  -> fanqie-workbench server
  -> ClaudeTerminalRuntime
  -> 每本书一个 tmux session
  -> 交互式 `claude`
  -> oh-story-claudecode skills
```

`tmux` 负责让 Claude Code 会话长期存活并可恢复。后续可以引入 PTY/Web terminal bridge 来提供更精确的实时终端流；第一版可以先使用 tmux 的 session 创建、命令注入和 pane capture。

## `.claude` 依赖模型

tmux session 必须使用同一个 macOS 用户，并从仓库根目录启动：

```text
/Users/huangzhipeng/Desktop/tomato 写作
```

Claude Code 应该能看到：

```text
CLAUDE.md
.claude/settings.local.json
.claude/hooks/
.claude/agents/
.claude/rules/
oh-story-claudecode/
novels/
fanqie-workbench/
```

这样可以保留 Claude Code 原生行为：skills、slash commands、hooks、rules、subagents、项目说明都会像普通终端会话中一样生效。

## 并发模型

- 全局 Claude Code runtime 并发：2 本书。
- 单本书并发：1 个运行中任务。
- 排队单位：书籍任务。

规则：

```text
if 同一本书已有运行中任务:
  加入该书队列
else if 全局运行中的书 < 2:
  启动或复用该书的 tmux runtime
else:
  加入全局等待队列
```

这允许两本不同的书同时运行，同时避免同一本书被并发编辑。

## 运行时 session 映射

每本书拥有一个持久 runtime session：

```text
bookId -> tmuxSessionName
```

建议 session 名：

```text
fanqie-book-<shortBookId>
```

runtime 记录应该追踪：

- bookId
- bookRoot
- tmuxSessionName
- status：`idle | running | waiting-input | failed | stopped`
- currentSessionId
- currentTask 描述
- lastActiveAt

第一版可以先复用现有 `sessions` 和 `session_messages` 表。后续如有需要，再迁移出专门的 runtime metadata 字段。

## 命令注入

Web 端章节动作会生成 Claude Code 原生命令，并发送到对应书籍的 tmux session。

示例：

### 续写/写章节

```text
/story-long-write 继续写《{bookTitle}》第 {chapterNumber} 章
书籍目录：{bookRoot}
章节文件：{chapterPath}
要求读取设定、大纲、追踪上下文，并将正文写入章节文件。
```

### 章节去 AI 味

```text
/story-deslop 处理章节
书籍目录：{bookRoot}
章节文件：{chapterPath}
要求直接修改原文件，保留剧情、人设、伏笔，只改变表达方式，并输出修改摘要。
```

### 章节审稿

```text
/story-review lean 审查章节
书籍目录：{bookRoot}
章节文件：{chapterPath}
目标平台：番茄
要求输出审稿报告，指出是否可以推进到「可发布」。
```

### 重写章节

```text
/story-long-write 重写第 {chapterNumber} 章
书籍目录：{bookRoot}
章节文件：{chapterPath}
用户要求：{userHint}
```

Web UI 负责表达结构化意图；Claude Code 负责执行具体写作行为。

## 数据流

```text
用户点击章节动作
  -> POST /api/sessions
  -> 创建 session 行
  -> scheduler 获取 book lock 和全局并发槽
  -> runtime 创建/复用 tmux session
  -> runtime 向 Claude Code 发送命令
  -> runtime 捕获终端输出
  -> 将输出追加到 session_messages
  -> LiveLogPanel 接收日志流
  -> Claude Code 修改 novels/<book>/ 下的文件
  -> workbench 扫描文件并更新章节阶段
```

## 产出物

写作产物的事实来源是文件系统，不是聊天记录。

推荐书籍结构：

```text
novels/<book>/
├── 设定/
├── 大纲/
├── 正文/
├── 追踪/
├── 审稿/
├── 发布/
└── 参考资料/
```

阶段产物：

| 阶段 | 主要产物 | Workbench 状态 |
| --- | --- | --- |
| 开书/初始化 | 设定、大纲、追踪文件、章节占位文件 | book + chapter rows |
| 初稿 | `正文/第XXX章_*.md` | `已初稿` |
| 去 AI 味 | 修改后的章节文件，可选去 AI 味报告 | `已去AI` |
| 审稿 | `审稿/第XXX章_审稿报告.md` 或终端报告 | `已审稿` |
| 确认可发布 | 用户/文件确认 | `可发布` |
| 发布 | 平台 ID 和发布状态 | `已发布` |

## 阶段推进

第一版不应该完全依赖解析 Claude Code 终端输出来判断阶段。

阶段推进应保守结合以下信号：

- 文件是否存在
- 文件修改时间
- 章节正文是否非空
- 可选报告文件是否存在
- Web UI 中的显式用户确认

等输出规范稳定后，再增加自动阶段推进。

## Web UI 行为

现有 `BooksPage` 继续作为主工作区。

需要新增：

- 每本书 runtime 状态：idle/running/waiting/failed。
- 连接到书籍 runtime session 的终端/日志面板。
- 向运行中 Claude Code session 发送文本的输入框。
- 停止、重启、attach/copy tmux 命令按钮。
- 任务因并发限制被阻塞时的队列展示。
- 任务结束后的手动阶段确认按钮。

## 失败恢复

runtime 应支持：

- 向当前 Claude Code session 发送 Ctrl+C。
- 重启该书的 tmux session。
- 将任务标记为 failed，但不删除已生成文件。
- 重新扫描书籍文件以恢复状态。
- 展示用于人工排查的 attach 命令：

```bash
tmux attach -t fanqie-book-<shortBookId>
```

## 发布上传边界

发布上传仍是下游阶段。

只有 `可发布` 状态的章节可以进入发布。现有 BookPublication/ChapterPublication 模型保留。Fanqie/Qidian/Qimao adapters 在写作 runtime 稳定后单独实现。

## 推荐实现阶段

### Phase 1：终端 runtime 骨架

- 新增 `ClaudeTerminalRuntime` 抽象。
- 实现 tmux session 的 create/list/send/capture/stop。
- 建立 bookId 到 tmux session name 的映射。
- 将捕获到的输出写入 `session_messages`。

### Phase 2：调度器

- 增加全局并发上限 2。
- 增加单本书 lock。
- 被阻塞的任务进入队列。

### Phase 3：章节动作接入

- 用 runtime 命令注入替换 session routes 中的 `claude -p` 调用。
- 为 write/deslop/review/rewrite 生成命令字符串。
- 保留现有 LiveLogPanel 和 session APIs。

### Phase 4：文件扫描和阶段确认

- runtime 任务完成后重新扫描变更文件。
- 增加保守阶段推进和手动确认。

### Phase 5：发布上传接入

- 等写作流程稳定后，继续接 publisher adapters。

## 待定决策

- tmux 输出捕获第一版用 polling，还是立刻做 PTY/WebSocket。
- 现在就新增专门的 runtime 表，还是第一版先复用 `sessions`。
- 审稿报告是否必须写入 `审稿/` 文件，还是初期可以只保留在 session 日志中。
