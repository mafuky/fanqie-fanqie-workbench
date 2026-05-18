# Claude Terminal Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 tmux 驱动真实交互式 Claude Code 会话，替换 `fanqie-workbench` 当前对 `claude -p` 的执行依赖。

**Architecture:** 保留现有 BooksPage、sessions API、LiveLogPanel、SQLite session/session_messages 数据流。新增 `ClaudeTerminalRuntime` 作为 tmux 适配层，新增调度器实现全局最多 2 本书并行、单本书串行，并把章节动作转换为 Claude Code slash command 注入到对应书籍的 tmux session。

**Tech Stack:** TypeScript, Fastify, React, better-sqlite3, Vitest, tmux CLI, Node child_process.

---

## 实现范围

本计划只实现写作 runtime 第一阶段：tmux session 创建/发送/捕获/停止、调度器、session 路由接入、Web 日志展示和手动阶段确认入口。不实现 Fanqie 发布适配器，不重写 `oh-story-claudecode` skills，不使用 Anthropic SDK 代替 Claude Code。

## 文件结构

### 新增文件

- `fanqie-workbench/src/claude/terminal-runtime.ts`
  - 封装 tmux CLI 操作：session 名生成、存在检测、创建、发送文本、发送 Ctrl+C、捕获 pane、停止 session。
  - 不直接操作数据库。

- `fanqie-workbench/src/claude/runtime-scheduler.ts`
  - 管理全局并发 2 和单 bookId 串行。
  - 接收可执行函数，负责排队、启动、释放 slot。
  - 纯内存调度，适合个人本地工作台第一版。

- `fanqie-workbench/src/claude/chapter-command-builder.ts`
  - 把章节动作转换成 Claude Code 原生指令。
  - 只生成字符串，不执行。

- `fanqie-workbench/src/claude/terminal-session-runner.ts`
  - 串联 runtime、scheduler、数据库 session_messages、SSE emitter。
  - 替代 `executeClaudePrompt` / `ClaudeSession` 在 session 路由中的核心执行用途。

- `fanqie-workbench/tests/claude/terminal-runtime.test.ts`
  - mock child_process，验证 tmux 命令参数。

- `fanqie-workbench/tests/claude/runtime-scheduler.test.ts`
  - 验证全局并发 2、同书串行、不同书并行。

- `fanqie-workbench/tests/claude/chapter-command-builder.test.ts`
  - 验证 write/deslop/review/rewrite 命令包含 bookRoot/chapterPath/userHint。

- `fanqie-workbench/tests/server/session-terminal-runtime.test.ts`
  - mock terminal runner，验证 `/api/sessions` 创建章节 session 后使用 terminal runtime 而不是 `claude -p`。

### 修改文件

- `fanqie-workbench/src/server/routes/sessions.ts`
  - 移除章节执行中的 `executeClaudePrompt` / `ClaudeSession` 依赖。
  - 调用 `runChapterTerminalSession()`。
  - 保留 prompt/book-entry 逻辑的兼容路径，后续任务再迁移。

- `fanqie-workbench/src/server/routes/chapters.ts`
  - 第一阶段不继续使用内部 `ClaudeSession` 跑旧 task pipeline；将 `/api/chapters/:chapterId/process` 标记为走 session runtime 或返回 409 指引使用 `/api/sessions`。
  - 避免留下新的 `claude -p` 路径。

- `fanqie-workbench/src/db/schema.ts`
  - 第一版尽量不改表结构。若需要保存 tmuxSessionName，先写入 `sessions.context_snapshot_json`。

- `fanqie-workbench/src/web/pages/books-page.tsx`
  - 增加任务结束后的阶段确认按钮。
  - 保持现有 `LiveLogPanel`。

- `fanqie-workbench/src/web/components/live-log-panel.tsx`
  - 增加可选 `onInput` UI 不在第一阶段强制实现；第一阶段只保留日志和 question UI。

---

## Task 1: tmux runtime 基础封装

**Files:**
- Create: `fanqie-workbench/src/claude/terminal-runtime.ts`
- Test: `fanqie-workbench/tests/claude/terminal-runtime.test.ts`

- [ ] **Step 1: 写失败测试：session 名生成要稳定且安全**

在 `fanqie-workbench/tests/claude/terminal-runtime.test.ts` 写入：

```ts
import { describe, expect, it } from 'vitest'
import { buildTmuxSessionName } from '../../src/claude/terminal-runtime.js'

describe('terminal runtime tmux session naming', () => {
  it('builds a stable tmux session name from book id', () => {
    expect(buildTmuxSessionName('book-1234567890abcdef')).toBe('fanqie-book-book-1234567')
  })

  it('sanitizes characters tmux session names should not contain', () => {
    expect(buildTmuxSessionName('book:with spaces/中文')).toBe('fanqie-book-book-with-s')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/terminal-runtime.test.ts
```

Expected: FAIL，提示无法找到 `terminal-runtime.js` 或 `buildTmuxSessionName`。

- [ ] **Step 3: 实现最小 session 名生成**

创建 `fanqie-workbench/src/claude/terminal-runtime.ts`：

```ts
import { spawn } from 'node:child_process'

export type TmuxCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

export function buildTmuxSessionName(bookId: string) {
  const safe = bookId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 12) || 'book'
  return `fanqie-book-${safe}`
}

export function runTmux(args: string[], options?: { cwd?: string }): Promise<TmuxCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('tmux', args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/terminal-runtime.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/claude/terminal-runtime.ts fanqie-workbench/tests/claude/terminal-runtime.test.ts
git commit -m "feat: add tmux terminal runtime naming"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 2: tmux create/send/capture/stop 操作

**Files:**
- Modify: `fanqie-workbench/src/claude/terminal-runtime.ts`
- Modify: `fanqie-workbench/tests/claude/terminal-runtime.test.ts`

- [ ] **Step 1: 写失败测试：mock tmux 命令执行器**

追加到 `fanqie-workbench/tests/claude/terminal-runtime.test.ts`：

```ts
import {
  createTerminalRuntime,
  type TmuxRunner,
} from '../../src/claude/terminal-runtime.js'

describe('terminal runtime tmux operations', () => {
  it('creates a detached Claude Code session in the project root', async () => {
    const calls: string[][] = []
    const runner: TmuxRunner = async (args) => {
      calls.push(args)
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const runtime = createTerminalRuntime({
      projectRoot: '/repo',
      runner,
    })

    await runtime.ensureSession({ bookId: 'book-1' })

    expect(calls).toEqual([
      ['has-session', '-t', 'fanqie-book-book-1'],
      ['new-session', '-d', '-s', 'fanqie-book-book-1', '-c', '/repo', 'claude'],
    ])
  })

  it('does not create a session that already exists', async () => {
    const calls: string[][] = []
    const runner: TmuxRunner = async (args) => {
      calls.push(args)
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const runtime = createTerminalRuntime({ projectRoot: '/repo', runner })

    await runtime.ensureSession({ bookId: 'book-1' })

    expect(calls).toEqual([
      ['has-session', '-t', 'fanqie-book-book-1'],
    ])
  })

  it('sends text followed by Enter to the book session', async () => {
    const calls: string[][] = []
    const runner: TmuxRunner = async (args) => {
      calls.push(args)
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const runtime = createTerminalRuntime({ projectRoot: '/repo', runner })

    await runtime.sendText({ bookId: 'book-1', text: '/story-deslop 处理章节' })

    expect(calls).toEqual([
      ['send-keys', '-t', 'fanqie-book-book-1', '/story-deslop 处理章节', 'Enter'],
    ])
  })

  it('captures pane output for the book session', async () => {
    const runner: TmuxRunner = async () => ({ exitCode: 0, stdout: 'Claude 输出', stderr: '' })
    const runtime = createTerminalRuntime({ projectRoot: '/repo', runner })

    await expect(runtime.capture({ bookId: 'book-1' })).resolves.toBe('Claude 输出')
  })

  it('sends Ctrl+C to interrupt the book session', async () => {
    const calls: string[][] = []
    const runner: TmuxRunner = async (args) => {
      calls.push(args)
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const runtime = createTerminalRuntime({ projectRoot: '/repo', runner })

    await runtime.interrupt({ bookId: 'book-1' })

    expect(calls).toEqual([
      ['send-keys', '-t', 'fanqie-book-book-1', 'C-c'],
    ])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/terminal-runtime.test.ts
```

Expected: FAIL，提示 `createTerminalRuntime` / `TmuxRunner` 未导出。

- [ ] **Step 3: 实现 runtime 操作**

替换 `fanqie-workbench/src/claude/terminal-runtime.ts` 为：

```ts
import { spawn } from 'node:child_process'

export type TmuxCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

export type TmuxRunner = (args: string[], options?: { cwd?: string }) => Promise<TmuxCommandResult>

export type TerminalRuntime = {
  ensureSession(input: { bookId: string }): Promise<{ sessionName: string; created: boolean }>
  sendText(input: { bookId: string; text: string }): Promise<void>
  capture(input: { bookId: string }): Promise<string>
  interrupt(input: { bookId: string }): Promise<void>
  stop(input: { bookId: string }): Promise<void>
}

export function buildTmuxSessionName(bookId: string) {
  const safe = bookId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 12) || 'book'
  return `fanqie-book-${safe}`
}

export function runTmux(args: string[], options?: { cwd?: string }): Promise<TmuxCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('tmux', args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

export function createTerminalRuntime(input: { projectRoot: string; runner?: TmuxRunner }): TerminalRuntime {
  const runner = input.runner ?? runTmux

  return {
    async ensureSession({ bookId }) {
      const sessionName = buildTmuxSessionName(bookId)
      const existing = await runner(['has-session', '-t', sessionName])
      if (existing.exitCode === 0) return { sessionName, created: false }

      const created = await runner(['new-session', '-d', '-s', sessionName, '-c', input.projectRoot, 'claude'])
      if (created.exitCode !== 0) {
        throw new Error(created.stderr || `tmux new-session failed for ${sessionName}`)
      }
      return { sessionName, created: true }
    },

    async sendText({ bookId, text }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['send-keys', '-t', sessionName, text, 'Enter'])
      if (result.exitCode !== 0) throw new Error(result.stderr || `tmux send-keys failed for ${sessionName}`)
    },

    async capture({ bookId }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['capture-pane', '-t', sessionName, '-p'])
      if (result.exitCode !== 0) throw new Error(result.stderr || `tmux capture-pane failed for ${sessionName}`)
      return result.stdout
    },

    async interrupt({ bookId }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['send-keys', '-t', sessionName, 'C-c'])
      if (result.exitCode !== 0) throw new Error(result.stderr || `tmux interrupt failed for ${sessionName}`)
    },

    async stop({ bookId }) {
      const sessionName = buildTmuxSessionName(bookId)
      const result = await runner(['kill-session', '-t', sessionName])
      if (result.exitCode !== 0) throw new Error(result.stderr || `tmux kill-session failed for ${sessionName}`)
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/terminal-runtime.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/claude/terminal-runtime.ts fanqie-workbench/tests/claude/terminal-runtime.test.ts
git commit -m "feat: add tmux terminal runtime operations"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 3: 章节命令生成器

**Files:**
- Create: `fanqie-workbench/src/claude/chapter-command-builder.ts`
- Test: `fanqie-workbench/tests/claude/chapter-command-builder.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `fanqie-workbench/tests/claude/chapter-command-builder.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildChapterCommand } from '../../src/claude/chapter-command-builder.js'

const base = {
  bookTitle: '雾港疑局',
  bookRoot: '/workspace/novels/雾港疑局',
  chapterNumber: 1,
  chapterTitle: '雾夜失踪',
  chapterPath: '/workspace/novels/雾港疑局/正文/第001章_雾夜失踪.md',
}

describe('chapter command builder', () => {
  it('builds a long-write command for drafting or continuing a chapter', () => {
    const command = buildChapterCommand({ ...base, action: 'chapter-write' })

    expect(command).toContain('/story-long-write')
    expect(command).toContain('继续写《雾港疑局》第 1 章')
    expect(command).toContain('书籍目录：/workspace/novels/雾港疑局')
    expect(command).toContain('章节文件：/workspace/novels/雾港疑局/正文/第001章_雾夜失踪.md')
  })

  it('builds a deslop command', () => {
    const command = buildChapterCommand({ ...base, action: 'chapter-deslop' })

    expect(command).toContain('/story-deslop')
    expect(command).toContain('保留剧情、人设、伏笔')
  })

  it('builds a lean review command for Fanqie', () => {
    const command = buildChapterCommand({ ...base, action: 'chapter-review' })

    expect(command).toContain('/story-review lean')
    expect(command).toContain('目标平台：番茄')
  })

  it('includes user hint for rewrite command', () => {
    const command = buildChapterCommand({ ...base, action: 'chapter-rewrite', userHint: '加强悬疑感' })

    expect(command).toContain('/story-long-write 重写第 1 章')
    expect(command).toContain('用户要求：加强悬疑感')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/chapter-command-builder.test.ts
```

Expected: FAIL，提示找不到 `chapter-command-builder.js`。

- [ ] **Step 3: 实现命令生成器**

创建 `fanqie-workbench/src/claude/chapter-command-builder.ts`：

```ts
export type ChapterCommandAction =
  | 'chapter-write'
  | 'chapter-polish'
  | 'chapter-deslop'
  | 'chapter-review'
  | 'chapter-rewrite'

export type ChapterCommandInput = {
  action: ChapterCommandAction
  bookTitle: string
  bookRoot: string
  chapterNumber: number
  chapterTitle: string
  chapterPath: string
  userHint?: string | null
}

function chapterHeader(input: ChapterCommandInput) {
  return `书籍目录：${input.bookRoot}\n章节文件：${input.chapterPath}`
}

export function buildChapterCommand(input: ChapterCommandInput) {
  if (input.action === 'chapter-write') {
    return `/story-long-write 继续写《${input.bookTitle}》第 ${input.chapterNumber} 章\n${chapterHeader(input)}\n要求读取设定、大纲、追踪上下文，并将正文写入章节文件。`
  }

  if (input.action === 'chapter-polish') {
    return `/story-long-write 润色《${input.bookTitle}》第 ${input.chapterNumber} 章《${input.chapterTitle}》\n${chapterHeader(input)}\n要求在不改变剧情、人设、伏笔的前提下提升文字表现，并直接修改原文件。${input.userHint ? `\n用户要求：${input.userHint}` : ''}`
  }

  if (input.action === 'chapter-deslop') {
    return `/story-deslop 处理章节\n${chapterHeader(input)}\n要求直接修改原文件，保留剧情、人设、伏笔，只改变表达方式，并输出修改摘要。`
  }

  if (input.action === 'chapter-review') {
    return `/story-review lean 审查章节\n${chapterHeader(input)}\n目标平台：番茄\n要求输出审稿报告，指出是否可以推进到「可发布」。`
  }

  return `/story-long-write 重写第 ${input.chapterNumber} 章\n${chapterHeader(input)}\n用户要求：${input.userHint || '按原章节目标重写，强化节奏和钩子。'}`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/chapter-command-builder.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/claude/chapter-command-builder.ts fanqie-workbench/tests/claude/chapter-command-builder.test.ts
git commit -m "feat: build Claude Code chapter commands"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 4: Runtime scheduler 并发控制

**Files:**
- Create: `fanqie-workbench/src/claude/runtime-scheduler.ts`
- Test: `fanqie-workbench/tests/claude/runtime-scheduler.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `fanqie-workbench/tests/claude/runtime-scheduler.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createRuntimeScheduler } from '../../src/claude/runtime-scheduler.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('runtime scheduler', () => {
  it('runs tasks for two different books concurrently', async () => {
    const scheduler = createRuntimeScheduler({ maxConcurrentBooks: 2 })
    const first = deferred<string>()
    const second = deferred<string>()
    const started: string[] = []

    const a = scheduler.run({ bookId: 'book-a' }, async () => {
      started.push('a')
      return first.promise
    })
    const b = scheduler.run({ bookId: 'book-b' }, async () => {
      started.push('b')
      return second.promise
    })

    await Promise.resolve()
    expect(started).toEqual(['a', 'b'])

    first.resolve('A')
    second.resolve('B')
    await expect(a).resolves.toBe('A')
    await expect(b).resolves.toBe('B')
  })

  it('queues a third book until a global slot is available', async () => {
    const scheduler = createRuntimeScheduler({ maxConcurrentBooks: 2 })
    const first = deferred<string>()
    const second = deferred<string>()
    const started: string[] = []

    void scheduler.run({ bookId: 'book-a' }, async () => {
      started.push('a')
      return first.promise
    })
    void scheduler.run({ bookId: 'book-b' }, async () => {
      started.push('b')
      return second.promise
    })
    const c = scheduler.run({ bookId: 'book-c' }, async () => {
      started.push('c')
      return 'C'
    })

    await Promise.resolve()
    expect(started).toEqual(['a', 'b'])

    first.resolve('A')
    await expect(c).resolves.toBe('C')
    expect(started).toEqual(['a', 'b', 'c'])
    second.resolve('B')
  })

  it('serializes tasks for the same book', async () => {
    const scheduler = createRuntimeScheduler({ maxConcurrentBooks: 2 })
    const first = deferred<string>()
    const started: string[] = []

    const a = scheduler.run({ bookId: 'book-a' }, async () => {
      started.push('a1')
      return first.promise
    })
    const b = scheduler.run({ bookId: 'book-a' }, async () => {
      started.push('a2')
      return 'A2'
    })

    await Promise.resolve()
    expect(started).toEqual(['a1'])

    first.resolve('A1')
    await expect(a).resolves.toBe('A1')
    await expect(b).resolves.toBe('A2')
    expect(started).toEqual(['a1', 'a2'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/runtime-scheduler.test.ts
```

Expected: FAIL，提示找不到 `runtime-scheduler.js`。

- [ ] **Step 3: 实现调度器**

创建 `fanqie-workbench/src/claude/runtime-scheduler.ts`：

```ts
type QueueItem<T> = {
  bookId: string
  work: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export type RuntimeScheduler = {
  run<T>(input: { bookId: string }, work: () => Promise<T>): Promise<T>
  getSnapshot(): { runningBookIds: string[]; queuedCount: number }
}

export function createRuntimeScheduler(input: { maxConcurrentBooks: number }): RuntimeScheduler {
  const runningBookIds = new Set<string>()
  const queuedBookIds = new Set<string>()
  const queue: QueueItem<unknown>[] = []

  function pump() {
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index]
      if (runningBookIds.has(item.bookId)) continue
      if (runningBookIds.size >= input.maxConcurrentBooks) return

      queue.splice(index, 1)
      queuedBookIds.delete(item.bookId)
      runningBookIds.add(item.bookId)
      void item.work().then(item.resolve, item.reject).finally(() => {
        runningBookIds.delete(item.bookId)
        pump()
      })
      index -= 1
    }
  }

  return {
    run<T>({ bookId }: { bookId: string }, work: () => Promise<T>) {
      return new Promise<T>((resolve, reject) => {
        queue.push({ bookId, work, resolve: resolve as (value: unknown) => void, reject })
        queuedBookIds.add(bookId)
        queueMicrotask(pump)
      })
    },

    getSnapshot() {
      return {
        runningBookIds: [...runningBookIds],
        queuedCount: queue.length,
      }
    },
  }
}

export const defaultRuntimeScheduler = createRuntimeScheduler({ maxConcurrentBooks: 2 })
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/runtime-scheduler.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/claude/runtime-scheduler.ts fanqie-workbench/tests/claude/runtime-scheduler.test.ts
git commit -m "feat: add Claude runtime scheduler"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 5: Terminal session runner 写入 session_messages

**Files:**
- Create: `fanqie-workbench/src/claude/terminal-session-runner.ts`
- Test: `fanqie-workbench/tests/claude/terminal-session-runner.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `fanqie-workbench/tests/claude/terminal-session-runner.test.ts`：

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createSession, getSessionMessages, getSessionById } from '../../src/db/repositories/sessions-repo.js'
import { runTerminalSessionCommand } from '../../src/claude/terminal-session-runner.js'
import type { TerminalRuntime } from '../../src/claude/terminal-runtime.js'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-terminal-runner-'))
  return resolve(dir, name)
}

describe('terminal session runner', () => {
  it('sends command, captures output, persists messages, and marks session succeeded', async () => {
    const databasePath = await createTempDatabasePath('terminal-runner.sqlite')
    const db = openDatabase(databasePath)
    const session = createSession(db, { kind: 'chapter', bookId: 'book-1', chapterId: 'chapter-1', currentSkill: 'chapter-deslop' })
    db.close()

    const calls: string[] = []
    const runtime: TerminalRuntime = {
      async ensureSession() { calls.push('ensure'); return { sessionName: 'fanqie-book-book-1', created: true } },
      async sendText(input) { calls.push(input.text) },
      async capture() { return 'Claude terminal output' },
      async interrupt() {},
      async stop() {},
    }

    await runTerminalSessionCommand({
      databasePath,
      sessionId: session.id,
      bookId: 'book-1',
      command: '/story-deslop 处理章节',
      runtime,
      captureDelayMs: 0,
    })

    expect(calls).toEqual(['ensure', '/story-deslop 处理章节'])

    const verifyDb = openDatabase(databasePath)
    const updated = getSessionById(verifyDb, session.id)
    const messages = getSessionMessages(verifyDb, session.id)
    verifyDb.close()

    expect(updated?.status).toBe('succeeded')
    expect(messages.map((message) => message.content).join('\n')).toContain('Claude terminal output')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/terminal-session-runner.test.ts
```

Expected: FAIL，提示找不到 `terminal-session-runner.js`。

- [ ] **Step 3: 实现 runner**

创建 `fanqie-workbench/src/claude/terminal-session-runner.ts`：

```ts
import { openDatabase } from '../db/client.js'
import { appendSessionMessage, updateSessionMetadata, updateSessionStatus } from '../db/repositories/sessions-repo.js'
import { getOrCreateEmitter } from './stream-capture.js'
import { createTerminalRuntime, type TerminalRuntime } from './terminal-runtime.js'

const WORKSPACE_ROOT = new URL('../../..', import.meta.url).pathname

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runTerminalSessionCommand(input: {
  databasePath: string
  sessionId: string
  bookId: string
  command: string
  runtime?: TerminalRuntime
  captureDelayMs?: number
}) {
  const runtime = input.runtime ?? createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
  const emitter = getOrCreateEmitter(input.sessionId)
  const db = openDatabase(input.databasePath)

  try {
    updateSessionStatus(db, input.sessionId, 'running')
    const ensured = await runtime.ensureSession({ bookId: input.bookId })
    updateSessionMetadata(db, input.sessionId, {
      contextSnapshotJson: JSON.stringify({ tmuxSessionName: ensured.sessionName }),
    })

    const inputMessageId = appendSessionMessage(db, input.sessionId, {
      role: 'user',
      stream: 'input',
      content: `${input.command}\n`,
    })
    emitter.emit('log', { id: inputMessageId, stream: 'input', chunk: `${input.command}\n` })

    await runtime.sendText({ bookId: input.bookId, text: input.command })
    await wait(input.captureDelayMs ?? 1000)
    const output = await runtime.capture({ bookId: input.bookId })

    if (output.trim()) {
      const outputMessageId = appendSessionMessage(db, input.sessionId, {
        role: 'assistant',
        stream: 'stdout',
        content: output,
      })
      emitter.emit('log', { id: outputMessageId, stream: 'stdout', chunk: output })
    }

    updateSessionStatus(db, input.sessionId, 'succeeded')
    emitter.emit('done', { status: 'succeeded' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const errorMessageId = appendSessionMessage(db, input.sessionId, {
      role: 'assistant',
      stream: 'stderr',
      content: message,
    })
    emitter.emit('log', { id: errorMessageId, stream: 'stderr', chunk: message })
    updateSessionStatus(db, input.sessionId, 'failed')
    emitter.emit('done', { status: 'failed' })
  } finally {
    db.close()
  }
}
```

- [ ] **Step 4: 修正 WORKSPACE_ROOT 解析**

如果测试或 TypeScript 报 `WORKSPACE_ROOT` 包含 URL 编码空格，替换该段：

```ts
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
```

最终文件顶部应包含：

```ts
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../db/client.js'
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/terminal-session-runner.test.ts
```

Expected: PASS。

- [ ] **Step 6: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/claude/terminal-session-runner.ts fanqie-workbench/tests/claude/terminal-session-runner.test.ts
git commit -m "feat: run Claude Code commands through terminal sessions"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 6: `/api/sessions` 章节动作改用 terminal runtime

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
- Test: `fanqie-workbench/tests/server/session-terminal-runtime.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `fanqie-workbench/tests/server/session-terminal-runtime.test.ts`：

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

const runTerminalSessionCommand = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/claude/terminal-session-runner.js', () => ({
  runTerminalSessionCommand,
}))

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-session-terminal-'))
  return resolve(dir, name)
}

describe('chapter sessions with terminal runtime', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    runTerminalSessionCommand.mockClear()
  })

  it('routes chapter actions to terminal runtime with a Claude Code command', async () => {
    const databasePath = await createTempDatabasePath('session-terminal.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/雾港疑局')
    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'chapter-1',
      'book-1',
      1,
      '雾夜失踪',
      '/tmp/雾港疑局/正文/第001章_雾夜失踪.md',
      '已初稿',
    )
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        kind: 'chapter',
        bookId: 'book-1',
        chapterId: 'chapter-1',
        currentSkill: 'chapter-deslop',
      },
    })

    expect(response.statusCode).toBe(201)
    const session = JSON.parse(response.body).session

    expect(runTerminalSessionCommand).toHaveBeenCalledWith(expect.objectContaining({
      databasePath,
      sessionId: session.id,
      bookId: 'book-1',
      command: expect.stringContaining('/story-deslop'),
    }))

    await app.close()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/session-terminal-runtime.test.ts
```

Expected: FAIL，因为 route 仍调用旧 executor 或 import 不存在。

- [ ] **Step 3: 修改 sessions route import**

在 `fanqie-workbench/src/server/routes/sessions.ts` 中新增：

```ts
import { buildChapterCommand, type ChapterCommandAction } from '../../claude/chapter-command-builder.js'
import { runTerminalSessionCommand } from '../../claude/terminal-session-runner.js'
```

保留 prompt/book-entry 暂时需要的旧 import：

```ts
import { ClaudeSession, type ClaudeEvent } from '../../claude/claude-executor.js'
```

删除该文件里对 `executeClaudePrompt` 的 import。

- [ ] **Step 4: 替换 chapterActionPrompts**

删除旧的：

```ts
const chapterActionPrompts: Record<string, (chapterTitle: string) => string> = {
  'chapter-polish': (chapterTitle) => `请调用 /chinese-novelist skill 润色章节 ${chapterTitle}`,
  'chapter-deslop': (chapterTitle) => `请调用 /story-deslop skill 处理章节 ${chapterTitle}`,
  'chapter-review': (chapterTitle) => `请调用 /story-review skill 审稿章节 ${chapterTitle}`,
  'chapter-rewrite': (chapterTitle) => `请调用 /chinese-novelist skill 重写章节 ${chapterTitle}`,
}
```

替换为：

```ts
const chapterActionMap: Record<string, ChapterCommandAction> = {
  'chapter-polish': 'chapter-polish',
  'chapter-deslop': 'chapter-deslop',
  'chapter-review': 'chapter-review',
  'chapter-rewrite': 'chapter-rewrite',
  'chapter-pipeline': 'chapter-write',
}
```

- [ ] **Step 5: 替换 `kind === 'chapter'` 分支执行逻辑**

在 `registerSessionRoutes` 的 `if (kind === 'chapter' && chapterId)` 分支内，查询 chapter 的 SQL 改成包含 book 信息：

```ts
const chapter = runDb.prepare(
  `SELECT c.id, c.stage, c.title, c.source_path, c.chapter_number, c.book_id,
          b.title AS book_title, b.root_path AS book_root
   FROM chapters c
   JOIN books b ON b.id = c.book_id
   WHERE c.id = ?`
).get(chapterId) as {
  id: string
  stage: string
  title: string
  source_path: string
  chapter_number: number
  book_id: string
  book_title: string
  book_root: string
} | undefined
```

然后用以下代码替换旧的 action/pipeline 执行块：

```ts
if (chapter) {
  const action = chapterActionMap[currentSkill || 'chapter-pipeline'] ?? 'chapter-write'
  const command = buildChapterCommand({
    action,
    bookTitle: chapter.book_title,
    bookRoot: chapter.book_root,
    chapterNumber: chapter.chapter_number,
    chapterTitle: chapter.title,
    chapterPath: chapter.source_path,
  })

  void runTerminalSessionCommand({
    databasePath: getDatabasePath(),
    sessionId: session.id,
    bookId: chapter.book_id,
    command,
  })
} else {
  updateSessionStatus(runDb, session.id, 'failed', currentSkill ?? null)
  appendAndEmitSessionMessage(runDb, session.id, emitter, {
    role: 'assistant',
    stream: 'stderr',
    content: 'chapter not found',
  })
  emitter.emit('done', { status: 'failed' })
}
runDb.close()
```

This intentionally removes automatic multi-stage advancement from this route; the terminal runtime sends one Claude Code command per Web action.

- [ ] **Step 6: 运行新增测试**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/session-terminal-runtime.test.ts
```

Expected: PASS。

- [ ] **Step 7: 运行相关 session 测试并记录失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/chapter-action-session.test.ts tests/server/session-chapter-execution.test.ts tests/server/session-chapter-hitl-execution.test.ts
```

Expected: Some old tests may fail because they assert `claude -p` output and auto-stage pipeline. Keep failures for Task 7 migration.

- [ ] **Step 8: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/server/routes/sessions.ts fanqie-workbench/tests/server/session-terminal-runtime.test.ts
git commit -m "feat: route chapter sessions through terminal runtime"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 7: 迁移旧 session 测试到新 runtime 行为

**Files:**
- Modify: `fanqie-workbench/tests/server/chapter-action-session.test.ts`
- Modify: `fanqie-workbench/tests/server/session-chapter-execution.test.ts`
- Modify: `fanqie-workbench/tests/server/session-chapter-hitl-execution.test.ts`

- [ ] **Step 1: 更新 chapter action 测试 mock**

在 `fanqie-workbench/tests/server/chapter-action-session.test.ts` 中，把旧 `vi.mock('../../src/claude/claude-executor.js', ...)` 替换为：

```ts
const runTerminalSessionCommand = vi.fn(async (input: { databasePath: string; sessionId: string }) => {
  const { openDatabase } = await import('../../src/db/client.js')
  const { appendSessionMessage, updateSessionStatus } = await import('../../src/db/repositories/sessions-repo.js')
  const db = openDatabase(input.databasePath)
  appendSessionMessage(db, input.sessionId, { role: 'assistant', stream: 'stdout', content: '已发送到 Claude Code 终端' })
  updateSessionStatus(db, input.sessionId, 'succeeded')
  db.close()
})

vi.mock('../../src/claude/terminal-session-runner.js', () => ({
  runTerminalSessionCommand,
}))
```

将断言从：

```ts
expect(stream.body).toContain('已完成润色')
```

改为：

```ts
expect(stream.body).toContain('已发送到 Claude Code 终端')
expect(runTerminalSessionCommand).toHaveBeenCalledWith(expect.objectContaining({
  command: expect.stringContaining('/story-long-write'),
}))
```

- [ ] **Step 2: 更新 full chapter pipeline 测试语义**

`session-chapter-execution.test.ts` 原本验证自动推进到 `可发布`。新 runtime 第一阶段不自动跑多阶段 pipeline。把测试名改成：

```ts
it('creates a terminal-backed chapter session and leaves stage confirmation to the user', async () => {
```

替换 mock 为：

```ts
const runTerminalSessionCommand = vi.fn(async (input: { databasePath: string; sessionId: string }) => {
  const { openDatabase } = await import('../../src/db/client.js')
  const { appendSessionMessage, updateSessionStatus } = await import('../../src/db/repositories/sessions-repo.js')
  const db = openDatabase(input.databasePath)
  appendSessionMessage(db, input.sessionId, { role: 'assistant', stream: 'stdout', content: 'Claude Code 已接收章节写作命令' })
  updateSessionStatus(db, input.sessionId, 'succeeded')
  db.close()
})

vi.mock('../../src/claude/terminal-session-runner.js', () => ({
  runTerminalSessionCommand,
}))
```

把章节状态断言改为：

```ts
expect(updatedChapter.stage).toBe('待写作')
```

把文件内容被改写的断言删除。保留 stream 断言：

```ts
expect(streamResponse.body).toContain('Claude Code 已接收章节写作命令')
expect(streamResponse.body).toContain('event: done')
```

- [ ] **Step 3: 更新 human-in-the-loop chapter 测试**

`session-chapter-hitl-execution.test.ts` 如果断言旧 `ClaudeSession` question 行为，改为验证：

```ts
expect(runTerminalSessionCommand).toHaveBeenCalled()
```

如果该测试必须保留 Web 回答能力，则把范围改到 `/api/sessions/:sessionId/answer` 已有 pendingQuestion 行为，不再由 terminal runtime 测试覆盖。

- [ ] **Step 4: 运行迁移后的测试**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/chapter-action-session.test.ts tests/server/session-chapter-execution.test.ts tests/server/session-chapter-hitl-execution.test.ts tests/server/session-terminal-runtime.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/tests/server/chapter-action-session.test.ts fanqie-workbench/tests/server/session-chapter-execution.test.ts fanqie-workbench/tests/server/session-chapter-hitl-execution.test.ts
git commit -m "test: update chapter sessions for terminal runtime"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 8: 旧 `/api/chapters/:chapterId/process` 路径降级

**Files:**
- Modify: `fanqie-workbench/src/server/routes/chapters.ts`
- Test: `fanqie-workbench/tests/server/chapter-process-route.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `fanqie-workbench/tests/server/chapter-process-route.test.ts`：

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app.js'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-chapter-process-'))
  return resolve(dir, name)
}

describe('chapter process route', () => {
  it('directs callers to session terminal runtime instead of running the legacy Claude executor', async () => {
    process.env.WORKBENCH_DB = await createTempDatabasePath('chapter-process.sqlite')
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/chapters/chapter-1/process',
      payload: { targetStage: '可发布' },
    })

    expect(response.statusCode).toBe(409)
    const body = JSON.parse(response.body)
    expect(body.error).toMatch(/session/i)

    await app.close()
    delete process.env.WORKBENCH_DB
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/chapter-process-route.test.ts
```

Expected: FAIL，当前 route 可能返回 404 或尝试旧 executor。

- [ ] **Step 3: 降级旧 process route**

在 `fanqie-workbench/src/server/routes/chapters.ts` 的 `/api/chapters/:chapterId/process` handler 顶部，直接返回：

```ts
return reply.code(409).send({
  error: 'Use /api/sessions with kind=chapter so the request runs through the Claude terminal runtime',
})
```

保留 batch process、rollback 等非执行型路由。后续清理可删除旧执行代码，但本任务只阻断旧 Claude executor 路径。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/chapter-process-route.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/server/routes/chapters.ts fanqie-workbench/tests/server/chapter-process-route.test.ts
git commit -m "fix: disable legacy chapter process executor"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 9: 手动阶段确认 API

**Files:**
- Modify: `fanqie-workbench/src/server/routes/chapters.ts`
- Test: `fanqie-workbench/tests/server/chapter-stage-confirm-route.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `fanqie-workbench/tests/server/chapter-stage-confirm-route.test.ts`：

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { buildServer } from '../../src/server/app.js'

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-stage-confirm-'))
  return resolve(dir, name)
}

describe('chapter stage confirmation route', () => {
  it('advances a chapter to the next valid stage', async () => {
    const databasePath = await createTempDatabasePath('stage-confirm.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'chapter-1', 'book-1', 1, '雾夜失踪', '/tmp/book/001.md', '已初稿'
    )
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/chapters/chapter-1/confirm-stage',
      payload: { targetStage: '已去AI' },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.currentStage).toBe('已去AI')

    const verifyDb = openDatabase(databasePath)
    const chapter = verifyDb.prepare('SELECT stage FROM chapters WHERE id = ?').get('chapter-1') as { stage: string }
    verifyDb.close()
    expect(chapter.stage).toBe('已去AI')

    await app.close()
    delete process.env.WORKBENCH_DB
  })

  it('rejects invalid stage jumps', async () => {
    const databasePath = await createTempDatabasePath('stage-confirm-invalid.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    db.prepare('INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)').run(
      'chapter-1', 'book-1', 1, '雾夜失踪', '/tmp/book/001.md', '已初稿'
    )
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: '/api/chapters/chapter-1/confirm-stage',
      payload: { targetStage: '可发布' },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
    delete process.env.WORKBENCH_DB
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/chapter-stage-confirm-route.test.ts
```

Expected: FAIL，route 不存在。

- [ ] **Step 3: 实现确认阶段 route**

在 `fanqie-workbench/src/server/routes/chapters.ts` 中，`rollback` route 前新增：

```ts
app.post<{
  Params: { chapterId: string }
  Body: { targetStage: ChapterStage }
}>('/api/chapters/:chapterId/confirm-stage', async (request, reply) => {
  const { chapterId } = request.params
  const { targetStage } = request.body || {} as any

  if (!targetStage) return reply.code(400).send({ error: 'targetStage is required' })

  const db = openDatabase(DB_PATH)
  const chapter = db.prepare('SELECT id, stage FROM chapters WHERE id = ?').get(chapterId) as { id: string; stage: ChapterStage } | undefined

  if (!chapter) {
    db.close()
    return reply.code(404).send({ error: 'chapter not found' })
  }

  const { canTransition } = await import('../../domain/chapter.js')
  if (!canTransition(chapter.stage, targetStage)) {
    db.close()
    return reply.code(400).send({ error: `Cannot confirm stage from ${chapter.stage} to ${targetStage}` })
  }

  db.prepare('UPDATE chapters SET stage = ? WHERE id = ?').run(targetStage, chapterId)
  db.close()
  return { chapterId, previousStage: chapter.stage, currentStage: targetStage }
})
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/chapter-stage-confirm-route.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/server/routes/chapters.ts fanqie-workbench/tests/server/chapter-stage-confirm-route.test.ts
git commit -m "feat: add manual chapter stage confirmation"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 10: BooksPage 显示阶段确认按钮

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Test: `fanqie-workbench/tests/web/books-page-session.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `fanqie-workbench/tests/web/books-page-session.test.tsx` 中追加测试：

```tsx
it('shows a manual stage confirmation button after a chapter session succeeds', async () => {
  // Use the existing fetch mock setup in this file. Add these responses if missing:
  // - /api/books returns one book
  // - /api/books/book-1 returns one chapter at 已初稿
  // - /api/books/book-1/sessions returns []
  // - /api/books/book-1/publications returns []
  // - POST /api/sessions returns { session: { id: 'session-1' } }
  // - /api/sessions/session-1/stream emits done with succeeded
  // The assertion below is the required behavior:
  expect(await screen.findByText('确认已去AI')).toBeInTheDocument()
})
```

If the existing test file does not have a reusable fetch mock, create a new focused file `fanqie-workbench/tests/web/books-page-stage-confirm.test.tsx` with the same render helpers used by nearby BooksPage tests.

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/books-page-session.test.tsx
```

Expected: FAIL，按钮不存在。

- [ ] **Step 3: 增加 next stage helper**

在 `fanqie-workbench/src/web/pages/books-page.tsx` 的常量区添加：

```ts
const NEXT_STAGE: Partial<Record<ChapterStage, ChapterStage>> = {
  '待写作': '已初稿',
  '已初稿': '已去AI',
  '已去AI': '已审稿',
  '已审稿': '可发布',
}
```

- [ ] **Step 4: 增加确认 handler**

在 `BooksPage` 组件中添加：

```ts
const handleConfirmChapterStage = useCallback(async (chapter: ChapterRow) => {
  const targetStage = NEXT_STAGE[chapter.stage]
  if (!targetStage) return
  try {
    const res = await fetch(`/api/chapters/${chapter.id}/confirm-stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetStage }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '确认阶段失败')
    toast.success(`已确认推进到「${targetStage}」`)
    await reloadExpandedBook()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '确认阶段失败')
  }
}, [reloadExpandedBook, toast])
```

- [ ] **Step 5: 在章节行成功后显示按钮**

在章节行操作区域中，`isProcessing` / `isReady` 判断附近加入：

```tsx
{sessionStatus === 'succeeded' && processingChapterId === ch.id && NEXT_STAGE[ch.stage] && (
  <Button
    variant="primary"
    size="sm"
    onClick={() => void handleConfirmChapterStage(ch)}
  >
    确认{NEXT_STAGE[ch.stage]}
  </Button>
)}
```

If `processingChapterId` is cleared immediately on success in `handleTaskDone`, adjust `handleTaskDone` so it does not clear `processingChapterId` until after confirmation:

```ts
if (success) {
  toast.success('章节处理完成，请确认阶段推进')
} else {
  setProcessingChapterId(null)
  toast.error('章节处理失败')
}
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
cd fanqie-workbench && npm test -- tests/web/books-page-session.test.tsx
```

Expected: PASS。

- [ ] **Step 7: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/web/pages/books-page.tsx fanqie-workbench/tests/web/books-page-session.test.tsx
git commit -m "feat: confirm chapter stages after terminal tasks"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 11: Runtime control endpoints for interrupt and stop

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
- Test: `fanqie-workbench/tests/server/session-runtime-control.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `fanqie-workbench/tests/server/session-runtime-control.test.ts`：

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'

const interrupt = vi.fn().mockResolvedValue(undefined)
const stop = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/claude/terminal-runtime.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/claude/terminal-runtime.js')>('../../src/claude/terminal-runtime.js')
  return {
    ...actual,
    createTerminalRuntime: () => ({
      ensureSession: vi.fn(),
      sendText: vi.fn(),
      capture: vi.fn(),
      interrupt,
      stop,
    }),
  }
})

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-runtime-control-'))
  return resolve(dir, name)
}

describe('session runtime controls', () => {
  it('interrupts the Claude Code tmux session for a book session', async () => {
    const databasePath = await createTempDatabasePath('runtime-control.sqlite')
    const db = openDatabase(databasePath)
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '雾港疑局', '/tmp/book')
    db.prepare('INSERT INTO sessions (id, kind, book_id, chapter_id, status, current_skill, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)')
      .run('session-1', 'chapter', 'book-1', 'running', 'chapter-deslop', new Date().toISOString(), new Date().toISOString())
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({ method: 'POST', url: '/api/sessions/session-1/interrupt' })

    expect(response.statusCode).toBe(200)
    expect(interrupt).toHaveBeenCalledWith({ bookId: 'book-1' })

    await app.close()
    delete process.env.WORKBENCH_DB
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/session-runtime-control.test.ts
```

Expected: FAIL，endpoint 不存在。

- [ ] **Step 3: 实现 interrupt endpoint**

在 `fanqie-workbench/src/server/routes/sessions.ts` 中引入：

```ts
import { createTerminalRuntime } from '../../claude/terminal-runtime.js'
```

添加 endpoint：

```ts
app.post<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/interrupt', async (request, reply) => {
  const db = openDatabase(getDatabasePath())
  const session = getSessionById(db, request.params.sessionId)
  db.close()

  if (!session) return reply.code(404).send({ error: 'session not found' })
  if (!session.bookId) return reply.code(400).send({ error: 'session has no bookId' })

  const runtime = createTerminalRuntime({ projectRoot: WORKSPACE_ROOT })
  await runtime.interrupt({ bookId: session.bookId })
  return { interrupted: true }
})
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/session-runtime-control.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/server/routes/sessions.ts fanqie-workbench/tests/server/session-runtime-control.test.ts
git commit -m "feat: add Claude runtime interrupt endpoint"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 12: 清理旧 `claude -p` 章节执行依赖

**Files:**
- Modify: `fanqie-workbench/src/server/routes/sessions.ts`
- Modify: `fanqie-workbench/src/server/routes/tasks.ts`
- Modify: `fanqie-workbench/src/server/routes/chapters.ts`
- Test: existing tests

- [ ] **Step 1: 搜索旧依赖**

Run:

```bash
grep -R "executeClaudePrompt\|ClaudeSession" -n fanqie-workbench/src/server fanqie-workbench/src/claude
```

Expected before cleanup: references remain only for prompt/book-entry compatibility and legacy `claude-executor.ts` itself.

- [ ] **Step 2: 保留 prompt/book-entry 旧路径，禁止章节路径使用旧 executor**

确认 `sessions.ts` 中：

- `runPromptSession()` 可以暂时保留 `ClaudeSession`，因为 book-entry 仍依赖多轮普通文本生成。
- `kind === 'chapter'` 不再调用 `ClaudeSession` 或 `executeClaudePrompt`。
- `chapters.ts` 的 `/api/chapters/:chapterId/process` 不再调用 `ClaudeSession`。

No code block is needed if Task 6 and Task 8 already satisfy this; otherwise apply the exact changes from those tasks.

- [ ] **Step 3: 为 tasks route 标注 legacy**

在 `fanqie-workbench/src/server/routes/tasks.ts` 的 `registerTaskRoutes` 上方添加短注释：

```ts
// Legacy prompt task endpoint. Book/chapter writing uses /api/sessions and ClaudeTerminalRuntime.
```

Do not remove `/api/tasks` yet; existing tests and debug UI may still depend on it.

- [ ] **Step 4: 运行搜索确认**

Run:

```bash
grep -R "executeClaudePrompt" -n fanqie-workbench/src/server/routes/sessions.ts fanqie-workbench/src/server/routes/chapters.ts
```

Expected: no output.

- [ ] **Step 5: 运行相关测试**

Run:

```bash
cd fanqie-workbench && npm test -- tests/server/session-terminal-runtime.test.ts tests/server/chapter-process-route.test.ts tests/server/tasks-route.test.ts
```

Expected: PASS。

- [ ] **Step 6: Commit**

If commit authorization is present for this execution session:

```bash
git add fanqie-workbench/src/server/routes/tasks.ts fanqie-workbench/src/server/routes/sessions.ts fanqie-workbench/src/server/routes/chapters.ts
git commit -m "refactor: isolate legacy Claude print executor"
```

If commit authorization is not present, leave changes unstaged and continue.

---

## Task 13: 端到端手动验证

**Files:**
- No code changes unless verification reveals a bug.

- [ ] **Step 1: 运行 focused tests**

Run:

```bash
cd fanqie-workbench && npm test -- tests/claude/terminal-runtime.test.ts tests/claude/runtime-scheduler.test.ts tests/claude/chapter-command-builder.test.ts tests/claude/terminal-session-runner.test.ts tests/server/session-terminal-runtime.test.ts tests/server/chapter-stage-confirm-route.test.ts tests/server/session-runtime-control.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行 full test suite**

Run:

```bash
cd fanqie-workbench && npm test
```

Expected: PASS. If unrelated pre-existing tests fail, record the exact failures and do not claim full verification.

- [ ] **Step 3: 启动本地服务**

Run:

```bash
cd fanqie-workbench && npm run dev:all
```

Expected:

```text
Server listening on http://127.0.0.1:4310
VITE ready on http://localhost:5173
```

- [ ] **Step 4: 手动验证 tmux 可用**

In another terminal, run:

```bash
tmux -V
```

Expected: prints tmux version. If tmux is missing, install tmux before manual runtime validation.

- [ ] **Step 5: Web UI golden path**

Open:

```text
http://localhost:5173
```

Manual flow:

1. Go to Books page.
2. Scan `novels/`.
3. Pick a book and chapter.
4. Click `···` → `去AI味`.
5. Confirm the log panel shows the injected command and captured tmux output.
6. Run:

```bash
tmux ls
```

Expected: a session named `fanqie-book-...` exists.

7. Attach if needed:

```bash
tmux attach -t fanqie-book-<shortBookId>
```

Expected: interactive Claude Code is running in project root.

- [ ] **Step 6: Verify `.claude` visibility inside tmux**

Inside the attached tmux session, use Claude Code normally or inspect current directory. Expected runtime root:

```text
/Users/huangzhipeng/Desktop/tomato 写作
```

Expected visible files:

```text
CLAUDE.md
.claude/settings.local.json
.claude/hooks
.claude/agents
.claude/rules
```

- [ ] **Step 7: Stop dev server**

Stop `npm run dev:all` with Ctrl+C.

- [ ] **Step 8: Commit verification fixes only if needed**

If verification required code fixes and commit authorization is present:

```bash
git add <fixed-files>
git commit -m "fix: stabilize Claude terminal runtime verification"
```

If no fixes were needed, do not create an empty commit.

---

## Self-review checklist

### Spec coverage

- tmux/PTY-style runtime: covered by Tasks 1, 2, 5, 11, 13.
- No `claude -p` for chapter execution: covered by Tasks 6, 8, 12.
- Preserve BooksPage/sessions/LiveLogPanel/session_messages: covered by Tasks 5, 6, 10.
- One tmux session per book: covered by Tasks 1, 2, 5.
- Global concurrency 2 and same-book serial execution: covered by Task 4.
- Command injection for write/deslop/review/rewrite: covered by Task 3 and Task 6.
- Terminal output persisted to `session_messages`: covered by Task 5.
- File scan/stage confirmation: conservative first version covered by Task 9 and Task 10.
- Publishing remains downstream: no publish adapter changes included.

### Placeholder scan

The plan contains no TBD/TODO/FIXME placeholders. The only conditional parts are explicit execution guards for commit authorization and test-file adaptation where existing test helpers may vary.

### Type consistency

Types introduced in this plan:

- `TerminalRuntime`, `TmuxRunner`, `TmuxCommandResult` in `terminal-runtime.ts`.
- `ChapterCommandAction`, `ChapterCommandInput` in `chapter-command-builder.ts`.
- `RuntimeScheduler` in `runtime-scheduler.ts`.

Later tasks use the same names and import paths.
