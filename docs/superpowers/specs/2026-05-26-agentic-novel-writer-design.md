# Agentic Novel Writer 设计

## 背景

fanqie-workbench 目前通过 Claude Code CLI（PTY + node-pty）执行所有写作动作。这条通道的根本问题：

1. 受限于 Claude Code 的 slash command 模型，能力扩展只能改 skill prompt
2. LLM 锁死在 Claude，无法切换 OpenAI / 其他
3. 终端流是黑盒，agent 在做什么、调了什么 tool、为什么这么写——用户看不到
4. PTY 通道脆弱（之前已经踩坑 HITL bug、isComplete 误判、问答检测）

本设计用**自研 agent runner + 可插拔 LLM provider** 替换 Claude Code 通道。能力包概念（`oh-story-claudecode`）依然保留在 Action Registry 层，新通道作为另一种 capability adapter。

## 范围

### 做

- **`chapter.continue` 端到端跑通**：从用户点击 → load 上下文 → 检查材料 → 写正文 → 写入 `.md` → 更新追踪文件 → web 刷新
- **OpenAI provider** 首期实现，provider 层抽象保留接 Anthropic / 其他 LLM 的空间
- **Phase 驱动 agent loop**：每个 phase 是独立 agent loop（system prompt + tools + 轮数上限），phase 之间顺序编排
- **多本书并行执行**：从第一天就支持，不允许 v2 重构
- **Web 原生 HITL**：agent 调 `ask_user` tool → web 弹问答卡片 → 用户回答 → agent 继续
- **结构化 trace**：tool 调用 / phase 边界 / 完整 message 写 SQLite，streaming delta 只走 WebSocket 不入库

### 不做

- `chapter.deslop`, `chapter.review`, `editor.selection.*`：v2 再加 phase，复用本设计的基础设施
- 扫榜 / 拆文 / 封面 / 短篇：oh-story-claudecode 脚本继续跑，跟 agent 无关
- Anthropic provider 实现：只留接口位
- 多 agent 协作 / 质控：v2 考虑
- 替换 fanqie-workbench 的市场情报 / 发布 / 编辑器 / 章节管理

### 与现有 Claude Code 通道的关系

**彻底替换**。完成后：

- 删除 `src/claude/pty-manager.ts`, `terminal-runtime.ts`, `book-entry-terminal-runner.ts`, `terminal-session-runner.ts`, `pty-event-parser.ts`, `terminal-capture-loop.ts`
- 删除 `src/server/routes/pty-ws.ts`
- 删除 `src/web/components/terminal-panel.tsx`, `live-log-panel.tsx`
- Action Registry 默认 capability 从 `oh-story-claudecode` 切到 `agentic`

短期过渡：在 spec 落地的前几个 phase 实现期间，旧通道保留可用；切换在最后一个 task 一次性完成。

## 架构

```
浏览器                              服务端                                     LLM
┌──────────────┐    WebSocket    ┌─────────────────────┐    HTTP/SSE   ┌──────────┐
│ AgentPanel   │◄══════════════►│ Agent Runner Pool   │◄═════════════►│ OpenAI   │
│  - phase 进度 │  事件流          │  - 多 bookId 并行   │  function call │ (provider │
│  - tool 流    │                │  - phase 编排       │                │  抽象)    │
│  - question   │                │  - tool 执行        │                └──────────┘
│  - 编辑器刷新 │                 │                     │
└──────────────┘                └─────┬───────────────┘
                                       │
                                       │ tool: read/write/grep/ask_user/update_tracking
                                       ▼
                                ┌─────────────┐         ┌─────────────┐
                                │ 文件系统     │         │ SQLite      │
                                │ novels/<书>/ │         │ agent_traces│
                                └─────────────┘         └─────────────┘
```

### 数据流：一次 `chapter.continue`

```
1. Web 用户点「继续写本章」
   → POST /api/actions { actionKey: 'chapter.continue', bookId, chapterId }

2. Action Router 解析:
   actionKey + capability='agentic' → phase 序列 [load-context, check-materials, write-chapter, update-tracking]

3. Agent Runner Pool:
   - 检查 bookId 是否已有 phase 在跑（同书互斥）
   - 检查全局并发上限（默认 5 本书并行）
   - 启 AgentRunner({bookId, chapterId, phases})

4. 每个 phase:
   - 构造 system prompt (phase 特定)
   - 加载 tool 集（按 phase 配置）
   - 调 provider.chat() → 模型可能返回 toolCalls
   - 执行 toolCalls → 把结果塞回 messages → 再调 provider.chat()
   - 直到没有 toolCall 或达到轮数上限
   - 触发 phase-done 事件

5. 期间所有事件（phase-start, tool-call, message, question, phase-done）:
   - 通过 EventEmitter 广播
   - WebSocket 转发给该 bookId 订阅者
   - Trace Store 持久化到 SQLite (delta 除外)

6. write_chapter phase 写入 novels/<书名>/正文/第N章_xxx.md
   update_tracking phase 写入 追踪/上下文.md, 伏笔.md, 时间线.md

7. 全部 phase 完成 → emit 'done'
   - 前端编辑器自动重载章节
   - Session 状态置为 succeeded
```

## 模块设计

代码全部新增在 `fanqie-workbench/src/agentic/`，跟 `src/claude/` 平级（最后删除 `src/claude/`）。

```
src/agentic/
├── providers/
│   ├── provider.ts             # LlmProvider 接口
│   ├── openai-provider.ts      # OpenAI 实现
│   └── anthropic-provider.ts   # 占位（v2 实现）
├── tools/
│   ├── tool.ts                 # Tool 接口和注册表
│   ├── read-file.ts
│   ├── write-file.ts
│   ├── grep.ts
│   ├── list-dir.ts
│   ├── ask-user.ts
│   └── update-tracking.ts
├── phases/
│   ├── phase.ts                # Phase 接口
│   ├── load-context.ts
│   ├── check-materials.ts
│   ├── write-chapter.ts
│   └── update-tracking.ts
├── agent-runner.ts             # 单次执行：phase 序列编排 + agent loop
├── agent-runner-pool.ts        # 多本书并行管理
├── action-router.ts            # actionKey → phase 序列
├── trace-store.ts              # SQLite 写入
└── events.ts                   # 事件类型定义
```

### 1. Provider 抽象 (`providers/provider.ts`)

```typescript
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]       // 仅 assistant
  toolCallId?: string          // 仅 tool 结果
  name?: string                // 仅 tool 名
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  usage: { promptTokens: number; completionTokens: number }
  finishReason: 'stop' | 'tool_calls' | 'length'
}

export interface LlmProvider {
  name: string
  chat(input: {
    messages: ChatMessage[]
    tools?: ToolSpec[]
    model: string
    maxTokens?: number
    temperature?: number
    onDelta?: (delta: string) => void  // 流式 token，仅推 WebSocket
  }): Promise<ChatResult>
}
```

**OpenAI 实现**：用 `openai` npm 包，模型默认 `gpt-5`（用户可在设置改），tool_choice 设 `auto`，开启 streaming 用 onDelta 推 token。

**关键约束**：provider 不感知 phase / book / agent loop，只是把 messages 翻译成 LLM 调用。Anthropic provider 后续接入只需新文件 + 选择器。

### 2. Tool 系统 (`tools/`)

每个 tool 是独立模块，实现统一接口：

```typescript
export interface Tool {
  spec: ToolSpec
  execute(input: {
    args: Record<string, unknown>
    bookId: string
    bookRoot: string  // novels/<书名>/
    emit(event: AgentEvent): void
  }): Promise<{ ok: true; result: string } | { ok: false; error: string }>
}
```

v1 tool 清单：

| Tool | 作用 | 副作用 |
|---|---|---|
| `read_file` | 读 bookRoot 内任意文件 | 无 |
| `list_dir` | 列目录 | 无 |
| `grep` | 在 bookRoot 内 grep | 无 |
| `write_file` | 写 bookRoot 内文件 | 写盘 + emit `file-updated` 事件 |
| `ask_user` | 触发 web 问答卡片，pause agent loop 等回答 | emit `question` 事件 |
| `update_tracking` | 写追踪文件（上下文/伏笔/时间线），强约束 schema | 写盘 |

所有 tool 通过 bookRoot 沙箱：路径必须 normalize 后在 bookRoot 内，否则返回 error。

`ask_user` 实现：emit `question` 事件 → AgentRunner 进入 `waiting-answer` 状态 → 不再调 provider → 用户回答（HTTP `/api/agent-sessions/:id/answer`）→ 把答案作为 tool result 塞回 messages → 继续 loop。

### 3. Phase 定义 (`phases/`)

每个 phase 是一个文件，导出：

```typescript
export interface Phase {
  name: string
  systemPrompt: (ctx: PhaseContext) => string
  tools: string[]            // 该 phase 允许调用的 tool 名
  initialUserMessage: (ctx: PhaseContext) => string
  maxIterations: number      // agent loop 最大轮数
  onComplete?: (ctx: PhaseContext, result: ChatResult) => Promise<void>
}

export interface PhaseContext {
  bookId: string
  bookRoot: string             // 绝对路径，如 /.../novels/长嫡归朝
  chapterId: string
  bookMeta: BookRecord         // 复用 src/db/repos/books-repo.ts 的类型
  chapter: ChapterRecord       // 复用 src/db/repos/chapters-repo.ts 的类型
  previousPhaseResults: Record<string, unknown>  // phase 间传递数据（如 load-context 的摘要）
}
```

v1 phase 序列（`chapter.continue`）：

1. **`load-context`**：读 `设定/`, `大纲/`, `追踪/上下文.md`, 上一章正文。tools: `read_file`, `list_dir`, `grep`。输出：本章可用上下文摘要。
2. **`check-materials`**：判断写本章需要的材料是否齐全（细纲、人物设定、伏笔表）。缺关键材料时调 `ask_user` 问用户怎么办。tools: `read_file`, `list_dir`, `ask_user`。输出：材料齐备 / 用户决定补 / 用户决定跳过软提醒。
3. **`write-chapter`**：根据上下文写本章正文，直接 `write_file` 到 `正文/第N章_xxx.md`。tools: `read_file`, `write_file`。轮数上限 5（一次写、可读补充）。
4. **`update-tracking`**：根据本章新内容更新 `追踪/上下文.md`、`追踪/伏笔.md`、`追踪/时间线.md`。tools: `read_file`, `update_tracking`。

每个 phase 的 system prompt 单独维护（参考 oh-story `story-long-write/skills/...` 内容做精简改写），不再走 slash command。

### 4. Agent Runner (`agent-runner.ts`)

```typescript
export interface AgentRunnerOptions {
  bookId: string
  chapterId: string
  phases: Phase[]
  provider: LlmProvider
  toolRegistry: ToolRegistry
  traceStore: TraceStore
  emitter: EventEmitter
}

export class AgentRunner {
  status: 'pending' | 'running' | 'waiting-answer' | 'succeeded' | 'failed' | 'cancelled'
  currentPhase: string | null

  async start(): Promise<void>
  cancel(): void
  submitAnswer(answer: string): void  // ask_user 的回答从这里进
}
```

**核心 agent loop**（每个 phase 内）：

```
messages = [{system}, {initial user}]
for iter in 1..maxIterations:
  result = await provider.chat({messages, tools})
  traceStore.write({phase, iter, messages, result})
  emit('message', {phase, role: 'assistant', content: result.content})
  if result.toolCalls.empty: break
  for toolCall in result.toolCalls:
    emit('tool-call', toolCall)
    if toolCall.name === 'ask_user':
      emit('question', ...)
      status = 'waiting-answer'
      answer = await waitForAnswer()  // promise resolved by submitAnswer
      messages.push({role: 'tool', toolCallId: toolCall.id, name: 'ask_user', content: answer})
    else:
      toolResult = await toolRegistry.execute(toolCall, {bookId, bookRoot, emit})
      messages.push({role: 'tool', toolCallId: toolCall.id, name: toolCall.name, content: toolResult})
emit('phase-done', {phase, result})
phase.onComplete?.(ctx, result)
```

**取消**：cancel() 设置 cancelled flag，下一次 await provider.chat() 前检查并抛出，进入 `failed` 状态。

### 5. Runner Pool (`agent-runner-pool.ts`)

多本书并行管理：

```typescript
export class AgentRunnerPool {
  private active: Map<string, AgentRunner>  // bookId → runner
  private maxConcurrent: number  // 默认 5

  async start(options: AgentRunnerOptions): Promise<AgentRunner>
    // 拒绝同书已有 runner
    // 拒绝超出 maxConcurrent
  get(bookId: string): AgentRunner | null
  cancel(bookId: string): void
}
```

**并发规则**：

- 同 bookId 同时只能跑一个 runner（避免写同一批文件冲突）
- 全局最多 `maxConcurrent` 本书并行（避免 OpenAI rate limit、UI 视觉混乱），可配置
- 超出时 API 返回 429 + 提示 "已达并发上限，请等待其他书完成"

**资源隔离**：每个 runner 自己的 EventEmitter，WebSocket 路由按 bookId 订阅。Tool 执行通过 bookRoot 隔离文件系统访问。

### 6. Action Router (`action-router.ts`)

```typescript
const ACTION_PHASES: Record<string, Phase[]> = {
  'chapter.continue': [loadContextPhase, checkMaterialsPhase, writeChapterPhase, updateTrackingPhase],
  // v2: 'chapter.deslop': [...], 'chapter.review': [...]
}

export function routeAction(actionKey: string): Phase[]
```

跟现有 `actionsService` 集成：当 action 的 capability 是 `agentic` 时，调 routeAction 拿 phase 序列，然后 `pool.start({phases, ...})`。

### 7. Trace Store (`trace-store.ts`)

SQLite 表（在现有 `better-sqlite3` DB 里加表）：

```sql
CREATE TABLE agent_traces (
  id INTEGER PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_id TEXT,
  action_key TEXT NOT NULL,
  session_id TEXT NOT NULL,  -- 关联 sessions 表
  status TEXT NOT NULL,      -- running/succeeded/failed/cancelled
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  total_prompt_tokens INTEGER DEFAULT 0,
  total_completion_tokens INTEGER DEFAULT 0,
  model TEXT
);
CREATE INDEX idx_agent_traces_book ON agent_traces(book_id, started_at DESC);

CREATE TABLE agent_trace_events (
  id INTEGER PRIMARY KEY,
  trace_id INTEGER NOT NULL REFERENCES agent_traces(id),
  phase_name TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- phase-start/message/tool-call/tool-result/question/phase-done/error
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_trace_events_trace ON agent_trace_events(trace_id, id);
```

**写入策略**：

| 事件 | 入库 | 推 WS |
|---|---|---|
| streaming delta（一个 token） | ❌ | ✅ |
| message（完整 assistant 回复） | ✅ | ✅ |
| tool-call | ✅ | ✅ |
| tool-result | ✅ | ✅ |
| question / answer | ✅ | ✅ |
| phase-start / phase-done / error | ✅ | ✅ |
| file-updated（write_file 触发） | ✅ | ✅ |

`better-sqlite3` 同步 + WAL 模式，单 phase 几十条事件不会成为瓶颈。多本书并行时所有写入串行排队，正常负载下毫秒级。

### 8. WebSocket 路由 (`src/server/routes/agent-ws.ts`)

替换 `pty-ws.ts`。每个 bookId 一个订阅频道：

```
GET /api/agent-sessions/:sessionId/stream → WebSocket
```

服务端消息：

```typescript
type ServerMessage =
  | { type: 'history'; events: TraceEvent[] }     // 重连时回放
  | { type: 'phase-start'; phase: string }
  | { type: 'message'; phase: string; role: string; content: string; delta?: boolean }
  | { type: 'tool-call'; phase: string; name: string; args: unknown }
  | { type: 'tool-result'; phase: string; name: string; result: unknown }
  | { type: 'question'; question: string; options: Array<{label: string}> }
  | { type: 'file-updated'; path: string }
  | { type: 'phase-done'; phase: string }
  | { type: 'done'; status: 'succeeded' | 'failed' | 'cancelled' }
  | { type: 'error'; message: string }

type ClientMessage =
  | { type: 'answer'; answer: string }
  | { type: 'cancel' }
```

### 9. 前端 AgentPanel (`src/web/components/agent-panel.tsx`)

替换 `terminal-panel.tsx`。布局：

```
┌─────────────────────────────────────────────────┐
│ Phase 进度条：                                    │
│ [✓ load-context] [⏳ check-materials] [check-materials] [write-chapter] [update-tracking] │
├─────────────────────────────────────────────────┤
│ 实时事件流（按 phase 折叠）：                       │
│ ▼ load-context                                  │
│   📖 read_file: 大纲/总纲.md                     │
│   📖 read_file: 追踪/上下文.md                   │
│   💬 (assistant) "本章应该承接上一章的..."        │
│   ✓ 完成 (3.2s, 1240 tokens)                    │
│ ▼ check-materials                               │
│   📖 list_dir: 设定/角色/                       │
│   ❓ Q: 第三章伏笔 X 是否要在本章回收？           │
│   [展开选项卡片]                                 │
└─────────────────────────────────────────────────┘
```

HITL 卡片直接渲染 question 事件的 options（沿用现有 `TerminalPanel` 的卡片 UI 风格）。

### 10. Session 模型适配

现有 `sessions` 表保留，作为 agent 执行的「会话」抽象。变更：

- 新增 `agent_traces` 表跟 `sessions` 通过 `session_id` 关联
- `sessions.status` 增加 `waiting-answer` 状态（之前已有）
- 删除 `sessions.tmux_session_name`、PTY 相关字段（如果有）

## 多本书并行的关键决策

1. **同书互斥**：runner pool 强制单 book 单 runner，避免并发写文件冲突
2. **全局并发上限**：默认 5，可在设置里改。超过则 action API 返回 429
3. **WebSocket 频道隔离**：每个连接绑定 sessionId，只收对应 runner 的事件
4. **Provider 调用不池化**：OpenAI SDK 自身有 connection pool，不再加额外队列
5. **共享 SQLite**：`better-sqlite3` WAL 模式支持多 reader + 单 writer 排队，无需分库
6. **取消传播**：用户在 UI 点取消 → WS 收到 cancel → runner.cancel() → 当前 LLM 调用结束后停止

## API 变更

新增：

```
POST   /api/agent-sessions                     # 启动 agent 执行（替代 PTY 启动）
GET    /api/agent-sessions/:id                 # 状态
POST   /api/agent-sessions/:id/answer          # ask_user 回答
POST   /api/agent-sessions/:id/cancel          # 取消
GET    /api/agent-sessions/:id/trace           # trace 列表（dashboard 用）
GET    /api/agent-sessions/:id/stream          # WebSocket
```

废弃（最后一个 task 删）：

```
GET    /api/sessions/:sessionId/terminal       # PTY WebSocket
POST   /api/sessions/:sessionId/answer         # tmux 时代的回答
POST   /api/sessions/:sessionId/interrupt      # tmux 时代的中断
```

`/api/actions` 保留，内部把 capability=agentic 的请求路由到 agent runner pool。

## TDD discipline

本设计的所有**确定性 plumbing** 必须 test-first，**LLM 输出质量** 不强制 TDD，靠人工 eval。

### 必须 test-first（红 → 绿 → 重构）

| 模块 | 第一批必须存在的测试 |
|---|---|
| `providers/openai-provider.ts` | mock fetch 后断言请求 body 结构、tools 格式、streaming chunk 解析、429/500 错误处理 |
| `tools/*.ts` | 沙箱路径越权返回 error、文件不存在返回 error、参数 schema 校验、`ask_user` emit question 事件 |
| `phases/*.ts` | mock provider 喂固定回复，断言 phase 在固定输入下走的步数 / 是否调对 tool / 是否更新 previousPhaseResults |
| `agent-runner.ts` | mock provider + tool，断言：phase 顺序执行、ask_user 后状态转 `waiting-answer`、submitAnswer 后恢复、cancel 在下次 chat 前抛出 |
| `agent-runner-pool.ts` | 同 book 第二次 start 抛错、超 maxConcurrent 拒绝（429）、cancel 释放 slot |
| `trace-store.ts` | 写入后能按 trace_id 查回；delta 不入库；token 用量累加正确 |
| `action-router.ts` | actionKey → phase 序列映射；未知 actionKey 抛 error |
| `src/server/routes/agent-ws.ts` | Fastify inject + ws 客户端，断言每种 ServerMessage 类型；reconnect 时收到 history 回放 |
| `src/web/components/agent-panel.tsx` | 收到各类 ServerMessage 时的渲染（phase 进度、tool 调用流、question 卡片、HITL answer 发送） |

### 不强制 TDD

| 内容 | 原因 | 怎么验收 |
|---|---|---|
| Phase 的 system prompt 文本 | LLM 输出非确定，无法断言「写出来的正文质量」 | 用 3 本现有书（长嫡归朝 / 那年盛夏 / 均分之上）各跑 1 章，diff 对比 oh-story-claudecode 在同一本书同一章上的输出，人工评分 |
| Tool 调用决策（模型选不选 read_file） | 模型行为，不可测 | E2E 时观察 trace，看是否符合预期 |
| 多 phase 间数据传递的具体形状 | 取决于 LLM 自由生成 | 同上，trace 里手工看 |

### 每个 implementation task 的"完成"定义

1. **测试先红**：写新测试，跑一下确认 fail（防止误把 stub 当通过）
2. **实现到绿**：写代码让测试通过
3. **重构**：在测试保护下整理代码
4. **跑全套**：`npm test` 不回归（230 个现有测试都过）
5. **手动 smoke**：模块层面跑一次真实调用（provider 真打 OpenAI / tool 真读真写文件），确认没有 mock 漏掉的副作用

不满足以上 5 条的 task 不算完成。

### 测试覆盖最小集

每个 implementation task 应至少包含：

- 1 个 happy path 测试
- 1 个 error path 测试
- 1 个 edge case 测试（空输入、超时、参数缺失等）

## 测试策略

按上面 TDD discipline 执行的同时，整体覆盖：

- **Provider 测试**：mock OpenAI HTTP，验证 messages/tools 格式、streaming 解析、错误处理
- **Tool 测试**：每个 tool 独立单元测试，重点测路径沙箱（防越权读写）
- **Phase 测试**：mock provider，喂入固定回复，验证 phase loop 行为（包括 ask_user pause/resume）
- **AgentRunner 测试**：mock provider + tool，验证 phase 编排、取消、状态机
- **Pool 测试**：验证同书互斥、并发上限、bookId 隔离
- **TraceStore 测试**：验证写入、查询、回放
- **WebSocket 集成测试**：Fastify inject + ws 客户端，验证事件协议
- **E2E**：跑通一次完整 chapter.continue（用最便宜的模型 / mock 模式），验证文件落盘和追踪文件更新
- **质量 eval**：每个新增 phase 完成后，用 3 本现有书 + 同章节跑一次，diff 对比 oh-story 输出

## 依赖变更

```json
{
  "dependencies": {
    "openai": "^4.x"
  }
}
```

**删除**（最后阶段）：`node-pty`、`@xterm/xterm`、`@xterm/addon-fit`、`@xterm/addon-web-links`。

**保留**：`@fastify/websocket`（agent-ws 继续用 WebSocket）、`better-sqlite3`。

## 环境配置

新增：

```
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1  # 可指向 azure / siliconflow 等
AGENT_DEFAULT_MODEL=gpt-5
AGENT_MAX_CONCURRENT_BOOKS=5
```

## 迁移策略

7 步迁移，每步独立可测：

1. **加 openai 依赖 + Provider 抽象 + OpenAI 实现**：可单独跑 `chat()` 验证
2. **Tool 系统 + 6 个 tool**：单元测试覆盖
3. **Phase 系统 + 4 个 phase**：mock provider 验证 phase 行为
4. **AgentRunner + Pool**：单 book 跑通端到端
5. **TraceStore + WebSocket 路由**：可在浏览器看到事件流
6. **AgentPanel 前端**：替换 TerminalPanel，HITL 卡片接通
7. **切 Action Router 默认 capability 到 agentic，删除 Claude Code 通道代码**

每步完成后跑测试 + 手动验证；最后一步合并到 master。

## 风险与约束

### LLM 成本

OpenAI gpt-5 写一章正文（~3000 字）大致 token：

- 输入：上下文 + 大纲 + 追踪文件 + system prompt ≈ 8k token
- 输出：正文 + tool 调用 ≈ 5k token
- 加上 phase load-context/check-materials 的额外调用，总成本接近 0.5 USD / 章

需要：

- 在设置里暴露当前模型，默认 gpt-5 但可换 gpt-5-mini / gpt-4o-mini 测试
- Trace 表存 token 用量，UI 上能看到本月成本

### Rate Limit

OpenAI tier 限速可能在多本书并行时触发。Pool 的 `maxConcurrent=5` 是经验值，要在测试时观察实际限速。

### Tool 越权

write_file / update_tracking 必须严格沙箱在 bookRoot 内，否则模型可能写到系统文件。所有路径 normalize 后 `startsWith(bookRoot)` 校验，失败返回 error 给模型。

### Phase prompt 质量

Phase system prompt 直接决定写作质量。v1 写完 phase 后必须用 3 本书各跑 1 章实测，对比 oh-story-claudecode 的输出质量。如果差距大，要回头调 prompt 或拆 phase。

### 同书互斥的用户体验

用户可能想同时跑 chapter.continue + chapter.review（写完立刻审）。v1 简化为同书必须串行；UI 上要明确提示「《xxx》正在执行 chapter.continue，请等待完成」。

### 文件冲突

agent 写 `正文/第N章.md` 时，用户可能正在编辑器里改。v1 处理：

- agent 启动时编辑器置只读 + 提示「Claude 正在写本章」
- agent 完成后自动 reload + 解锁

## 不在本次范围

- `chapter.deslop`, `chapter.review`, `editor.selection.*` 等其他动作（v2 加 phase 即可）
- Anthropic / 其他 provider 实现
- 多 agent 协作（架构 agent / 人设 agent 分工）
- Trace dashboard UI（v2 用 agent_traces 表做）
- 自动 prompt 优化 / 反思机制
- Agent context window 压缩策略（短期靠 phase 切分天然分段）

## 验收标准

完成后必须 fresh verification：

- 所有新增模块单元测试通过
- E2E：用 fixture 书跑一次 `chapter.continue`，验证正文 .md 落盘 + 追踪文件更新
- 多本书并行测试：同时启 2 本书的 chapter.continue，确认互不干扰
- 手动验证：浏览器里点继续写本章，能看到 phase 进度条 / tool 调用流 / 编辑器自动刷新
- 旧 Claude Code 通道完全删除，相关代码 + 测试 + 路由全部清理
