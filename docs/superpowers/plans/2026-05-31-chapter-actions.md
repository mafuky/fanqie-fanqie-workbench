# 章节动作 (编剧 / 写下一章 / AI改稿) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为单书工作台补齐章节级动作——编剧本章 (`chapter.outline`)、写下一章一条龙 (`chapter.next`)、AI 改稿本章 (`chapter.revise`)，并补齐当前点了会抛 `unknown action` 的 `chapter.deslop` / `chapter.review`，同时确认手动编辑入口仍可用。

**Architecture:** 沿用现有 phase-pipeline 架构 (`action-router` 把 actionKey 映射到一串 `Phase`，`agent-runner` 顺序执行并把每个 phase 的 `onComplete` 结果累积进 `previousPhaseResults`)。本计划新增 4 个 phase (`write-outline` / `revise-chapter` / `deslop-chapter` / `review-chapter`)，给 runner/pool/service 加一条可选的 `initialResults` 透传管道 (用于把用户改稿指令塞进 `previousPhaseResults.reviseInstruction`)，给 `POST /api/agent-sessions` 加可选 `instruction`，并新增 `POST /api/agent-sessions/chapter-next` 端点 (因为下一章还不存在，必须先建占位章再启动 agent)。前端在动作按钮行新增三个按钮，AI 改稿用 inline 指令输入框。

**Tech Stack:** Fastify 5, better-sqlite3, React 19, vitest, TypeScript ESM (.js import suffixes)

---

## 范围对照 (spec 第二部分 F–I)

| spec | 内容 | 落地 task |
|---|---|---|
| F | `write-outline` phase | Task 1 |
| F | `revise-chapter` phase | Task 2 |
| G | `deslop-chapter` / `review-chapter` 最小 phase | Task 3 |
| G | action-router 注册新 actionKey | Task 4 |
| G | runner `initialResults` 透传 (`reviseInstruction`) | Task 5 |
| G | pool / service 透传 `initialResults` | Task 6 |
| G | `POST /api/agent-sessions` 加可选 `instruction` | Task 7 |
| H | `POST /api/agent-sessions/chapter-next` 新端点 | Task 8 |
| I | 工作台 UI：编剧本章 / AI 改稿本章 / 写下一章 | Task 9 |
| I | 手动编辑入口确认 (a) | Task 10 |

LLM 输出质量 (outline / 正文 / 改稿 / 审查) 人工 eval，不强制 test-first；但 phase 的 `name` / `tools` / `onComplete` 契约、router 映射、`initialResults` 透传、`/chapter-next` 端点、UI 接线全部 test-first。

---

## File Structure

新建：
- `fanqie-workbench/src/agentic/phases/write-outline.ts`
- `fanqie-workbench/src/agentic/phases/revise-chapter.ts`
- `fanqie-workbench/src/agentic/phases/deslop-chapter.ts`
- `fanqie-workbench/src/agentic/phases/review-chapter.ts`
- `fanqie-workbench/tests/agentic/write-outline.test.ts`
- `fanqie-workbench/tests/agentic/revise-chapter.test.ts`
- `fanqie-workbench/tests/agentic/deslop-review-phases.test.ts`
- `fanqie-workbench/tests/agentic/agent-runner-initial-results.test.ts`
- `fanqie-workbench/tests/server/agent-sessions-chapter-next.test.ts`

修改：
- `fanqie-workbench/src/agentic/action-router.ts` (注册 5 个新 actionKey)
- `fanqie-workbench/src/agentic/agent-runner.ts` (新增 `initialResults?` 选项并预置 `previousPhaseResults`)
- `fanqie-workbench/src/agentic/agent-runner-pool.ts` (透传 `initialResults`)
- `fanqie-workbench/src/agentic/agent-service.ts` (`AgentStartInput.initialResults` 透传)
- `fanqie-workbench/src/server/routes/agent-sessions.ts` (`/agent-sessions` 加 `instruction`；新增 `/chapter-next`)
- `fanqie-workbench/src/web/pages/book-workspace-page.tsx` (新增三个按钮 + AI 改稿 inline 输入框 + 写下一章 handler)
- `fanqie-workbench/tests/agentic/action-router.test.ts` (新 actionKey 断言)
- `fanqie-workbench/tests/server/agent-sessions-route.test.ts` (instruction 透传断言)
- `fanqie-workbench/tests/web/book-workspace-page.test.tsx` (新按钮 / 改稿 / 写下一章断言)

> **现有测试约定（务必遵守，已核对 tests/）**：
> - server route 测试用 `import Database from 'better-sqlite3'` + `import { schemaSql } from '../../src/db/schema.js'`，`new Database(':memory:'); db.exec(schemaSql)` 建库（**不要** 用 `openDatabase(':memory:')` 或 `migrate()`，二者不存在）。
> - fake `AgentService` 用工厂模式：`fakeService({ start: async (input) => { startInput = input; return {...} as AgentRunner } })`，通过闭包变量 `startInput` 捕获，**不要** 假设 service 上有 `lastStart` 字段。
> - `LlmProvider` 对象必须含 `name: 'fake'` 字段；`ChatResult` 必须含 `finishReason`（`'stop' | 'tool_calls' | 'length'`）。本计划下文测试桩已据此给出。
> - 章节级 action 的 server 测试文件统一落在 `tests/server/`，命名 `*-route.test.ts` 或本计划指定的新文件名。

类型与命名约定 (跨 task 必须一致)：
- phase 导出名：`writeOutlinePhase` / `reviseChapterPhase` / `deslopChapterPhase` / `reviewChapterPhase`
- phase `name` 字段：`write-outline` / `revise-chapter` / `deslop-chapter` / `review-chapter`
- runner / pool / service 新字段：`initialResults?: Record<string, unknown>`
- 改稿指令在 `previousPhaseResults` 里的 key：`reviseInstruction`
- `/agent-sessions` body 新字段：`instruction?: string`
- 章节文件名 padding：`String(n).padStart(3, '0')`
- 细纲路径：`join(bookRoot, '大纲', \`细纲_第${NNN}章.md\`)`
- 正文路径：`join(bookRoot, '正文', \`第${NNN}章.md\`)`

---

## Task 1 — `write-outline` phase（编剧）

实现 spec F 的 `write-outline`：tools `['read_file', 'list_dir', 'write_file']`，maxIterations 6，写 `大纲/细纲_第NNN章.md`。phase 契约 (name/tools/prompt 含路径/onComplete) test-first；prompt 文案属 LLM 质量，只断言关键路径串。

**Files:**
- `fanqie-workbench/src/agentic/phases/write-outline.ts` (新建)
- `fanqie-workbench/tests/agentic/write-outline.test.ts` (新建)

步骤：

- [ ] 写失败测试 `fanqie-workbench/tests/agentic/write-outline.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { writeOutlinePhase } from '../../src/agentic/phases/write-outline.js'
import type { PhaseContext } from '../../src/agentic/phases/phase.js'

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    bookId: 'b1',
    bookRoot: '/tmp/book',
    chapterId: 'c1',
    bookMeta: { id: 'b1', title: '测试书', rootPath: '/tmp/book' },
    chapter: { id: 'c1', chapterNumber: 7, title: '第七章', sourcePath: '/tmp/book/正文/第007章.md', stage: '待写作' },
    previousPhaseResults: { contextSummary: '前情摘要' },
    ...overrides,
  }
}

describe('writeOutlinePhase', () => {
  it('has correct name and write-capable tools', () => {
    expect(writeOutlinePhase.name).toBe('write-outline')
    expect(writeOutlinePhase.tools).toEqual(['read_file', 'list_dir', 'write_file'])
    expect(writeOutlinePhase.maxIterations).toBe(6)
  })

  it('systemPrompt targets the zero-padded outline path and references settings/tracking', () => {
    const prompt = writeOutlinePhase.systemPrompt(makeCtx())
    expect(prompt).toContain('/tmp/book/大纲/细纲_第007章.md')
    expect(prompt).toContain('设定')
    expect(prompt).toContain('追踪')
    expect(prompt).toContain('第7章')
  })

  it('initialUserMessage passes the context summary through', () => {
    const msg = writeOutlinePhase.initialUserMessage(makeCtx())
    expect(msg).toContain('前情摘要')
  })

  it('onComplete returns outlineWritten flag', async () => {
    const result = await writeOutlinePhase.onComplete!(makeCtx(), {
      content: 'done', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 },
    } as any)
    expect(result).toEqual({ outlineWritten: true })
  })
})
```

- [ ] 运行测试，确认 FAIL：`cd fanqie-workbench && npx vitest run tests/agentic/write-outline.test.ts`（应报 cannot find module write-outline）

- [ ] 实现 `fanqie-workbench/src/agentic/phases/write-outline.ts`：

```ts
import { join } from 'node:path'
import type { Phase } from './phase.js'

export const writeOutlinePhase: Phase = {
  name: 'write-outline',
  tools: ['read_file', 'list_dir', 'write_file'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    const nnn = String(chapter.chapterNumber).padStart(3, '0')
    const outlinePath = join(ctx.bookRoot, '大纲', `细纲_第${nnn}章.md`)
    return [
      `你是网文长篇写作助手，正在为《${ctx.bookMeta.title}》编排第${chapter.chapterNumber}章「${chapter.title}」的细纲（剧本）。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${outlinePath}`,
      ``,
      `职责：`,
      `1. 用 list_dir 查看 设定/、大纲/、追踪/ 目录。`,
      `2. 用 read_file 读取 设定/ 下相关设定、大纲/总纲.md、追踪/上下文.md。`,
      `3. 读取上一章正文，确认本章应承接的剧情与衔接点。`,
      `4. 为第${chapter.chapterNumber}章写细纲，覆盖：场景设定、出场人物、关键事件、信息揭示、章末钩子。`,
      `5. 篇幅 300-500 字，可执行、具体，不要空话。`,
      `6. 最后用 write_file 工具把细纲写到 ${outlinePath}。`,
      `7. 不要 ask_user，所有决定独立做。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    const nnn = String(chapter.chapterNumber).padStart(3, '0')
    const outlinePath = join(ctx.bookRoot, '大纲', `细纲_第${nnn}章.md`)
    return [
      `上下文摘要：`,
      String(ctx.previousPhaseResults.contextSummary ?? ''),
      ``,
      `请编排第${chapter.chapterNumber}章细纲，写完后用 write_file 写入 ${outlinePath}。`,
    ].join('\n')
  },
  async onComplete(_ctx, _result) {
    return { outlineWritten: true }
  },
}
```

- [ ] 运行测试，确认 PASS：`cd fanqie-workbench && npx vitest run tests/agentic/write-outline.test.ts`

- [ ] 提交：

```
git add fanqie-workbench/src/agentic/phases/write-outline.ts fanqie-workbench/tests/agentic/write-outline.test.ts
git commit -m "feat(agentic): add write-outline phase for chapter.outline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — `revise-chapter` phase（AI 改稿）

实现 spec F 的 `revise-chapter`：tools `['read_file', 'write_file']`，maxIterations 6，从 `ctx.previousPhaseResults.reviseInstruction` 取指令，读 `ctx.chapter.sourcePath` + `追踪/上下文.md`，按指令改写并覆盖回 sourcePath。指令为空时 `onComplete` 不报错。

**Files:**
- `fanqie-workbench/src/agentic/phases/revise-chapter.ts` (新建)
- `fanqie-workbench/tests/agentic/revise-chapter.test.ts` (新建)

步骤：

- [ ] 写失败测试 `fanqie-workbench/tests/agentic/revise-chapter.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { reviseChapterPhase } from '../../src/agentic/phases/revise-chapter.js'
import type { PhaseContext } from '../../src/agentic/phases/phase.js'

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    bookId: 'b1',
    bookRoot: '/tmp/book',
    chapterId: 'c1',
    bookMeta: { id: 'b1', title: '测试书', rootPath: '/tmp/book' },
    chapter: { id: 'c1', chapterNumber: 5, title: '第五章', sourcePath: '/tmp/book/正文/第005章.md', stage: '已写作' },
    previousPhaseResults: { reviseInstruction: '把男主改得更冷酷一点' },
    ...overrides,
  }
}

describe('reviseChapterPhase', () => {
  it('has correct name and read+write tools', () => {
    expect(reviseChapterPhase.name).toBe('revise-chapter')
    expect(reviseChapterPhase.tools).toEqual(['read_file', 'write_file'])
    expect(reviseChapterPhase.maxIterations).toBe(6)
  })

  it('systemPrompt targets the chapter sourcePath and mentions tracking context', () => {
    const prompt = reviseChapterPhase.systemPrompt(makeCtx())
    expect(prompt).toContain('/tmp/book/正文/第005章.md')
    expect(prompt).toContain('追踪/上下文.md')
  })

  it('initialUserMessage carries the revise instruction from previousPhaseResults', () => {
    const msg = reviseChapterPhase.initialUserMessage(makeCtx())
    expect(msg).toContain('把男主改得更冷酷一点')
  })

  it('initialUserMessage does not throw when instruction is missing', () => {
    const msg = reviseChapterPhase.initialUserMessage(makeCtx({ previousPhaseResults: {} }))
    expect(typeof msg).toBe('string')
  })

  it('onComplete returns revised flag without error when instruction empty', async () => {
    const result = await reviseChapterPhase.onComplete!(makeCtx({ previousPhaseResults: {} }), {
      content: 'done', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 },
    } as any)
    expect(result).toEqual({ revised: true })
  })
})
```

- [ ] 运行测试，确认 FAIL：`cd fanqie-workbench && npx vitest run tests/agentic/revise-chapter.test.ts`

- [ ] 实现 `fanqie-workbench/src/agentic/phases/revise-chapter.ts`：

```ts
import type { Phase } from './phase.js'

export const reviseChapterPhase: Phase = {
  name: 'revise-chapter',
  tools: ['read_file', 'write_file'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文长篇写作助手，正在按用户指令修改《${ctx.bookMeta.title}》第${chapter.chapterNumber}章「${chapter.title}」的正文。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${chapter.sourcePath}`,
      ``,
      `要求：`,
      `1. 先确认用户的改稿指令存在（见下方用户消息）；若指令为空，回复说明缺少指令、不要乱改文件。`,
      `2. 用 read_file 读当前正文 ${chapter.sourcePath}。`,
      `3. 用 read_file 读 追踪/上下文.md，保持人物状态与设定一致。`,
      `4. 严格按指令改写正文，保留未被指令涉及的部分，整体风格自然、避免 AI 套路。`,
      `5. 最后用 write_file 工具把改写后的完整正文覆盖写回 ${chapter.sourcePath}。`,
      `6. 不要 ask_user，所有决定独立做。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    const instruction = String(ctx.previousPhaseResults.reviseInstruction ?? '').trim()
    return [
      `改稿指令：`,
      instruction || '（用户未提供指令，请说明缺少指令而不要修改文件）',
      ``,
      `上下文摘要：`,
      String(ctx.previousPhaseResults.contextSummary ?? ''),
      ``,
      `请按指令修改第${chapter.chapterNumber}章正文，写完后用 write_file 覆盖写入 ${chapter.sourcePath}。`,
    ].join('\n')
  },
  async onComplete(_ctx, _result) {
    return { revised: true }
  },
}
```

- [ ] 运行测试，确认 PASS：`cd fanqie-workbench && npx vitest run tests/agentic/revise-chapter.test.ts`

- [ ] 提交：

```
git add fanqie-workbench/src/agentic/phases/revise-chapter.ts fanqie-workbench/tests/agentic/revise-chapter.test.ts
git commit -m "feat(agentic): add revise-chapter phase reading reviseInstruction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — `deslop-chapter` + `review-chapter` 最小 phase

实现 spec G 的最小补齐：`deslop-chapter`（去 AI 味改写正文，tools `['read_file', 'write_file']`，覆盖 sourcePath）与 `review-chapter`（产出审查意见到 assistant 消息，只读，tools `['read_file', 'list_dir']`，不写文件）。只为消除 `unknown action`，不追求 oh-story skill 同等深度。

**Files:**
- `fanqie-workbench/src/agentic/phases/deslop-chapter.ts` (新建)
- `fanqie-workbench/src/agentic/phases/review-chapter.ts` (新建)
- `fanqie-workbench/tests/agentic/deslop-review-phases.test.ts` (新建)

步骤：

- [ ] 写失败测试 `fanqie-workbench/tests/agentic/deslop-review-phases.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { deslopChapterPhase } from '../../src/agentic/phases/deslop-chapter.js'
import { reviewChapterPhase } from '../../src/agentic/phases/review-chapter.js'
import type { PhaseContext } from '../../src/agentic/phases/phase.js'

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    bookId: 'b1',
    bookRoot: '/tmp/book',
    chapterId: 'c1',
    bookMeta: { id: 'b1', title: '测试书', rootPath: '/tmp/book' },
    chapter: { id: 'c1', chapterNumber: 6, title: '第六章', sourcePath: '/tmp/book/正文/第006章.md', stage: '已写作' },
    previousPhaseResults: { contextSummary: '前情摘要' },
    ...overrides,
  }
}

describe('deslopChapterPhase', () => {
  it('rewrites the chapter file in place', () => {
    expect(deslopChapterPhase.name).toBe('deslop-chapter')
    expect(deslopChapterPhase.tools).toEqual(['read_file', 'write_file'])
    const prompt = deslopChapterPhase.systemPrompt(makeCtx())
    expect(prompt).toContain('/tmp/book/正文/第006章.md')
    expect(prompt).toContain('AI')
  })

  it('onComplete returns deslopped flag', async () => {
    const result = await deslopChapterPhase.onComplete!(makeCtx(), {
      content: 'done', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 },
    } as any)
    expect(result).toEqual({ deslopped: true })
  })
})

describe('reviewChapterPhase', () => {
  it('is read-only and produces notes', () => {
    expect(reviewChapterPhase.name).toBe('review-chapter')
    expect(reviewChapterPhase.tools).toEqual(['read_file', 'list_dir'])
    const prompt = reviewChapterPhase.systemPrompt(makeCtx())
    expect(prompt).toContain('/tmp/book/正文/第006章.md')
    expect(prompt).not.toContain('write_file')
  })

  it('onComplete returns reviewNotes from result content', async () => {
    const result = await reviewChapterPhase.onComplete!(makeCtx(), {
      content: '审查意见正文', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 },
    } as any)
    expect(result).toEqual({ reviewNotes: '审查意见正文' })
  })
})
```

- [ ] 运行测试，确认 FAIL：`cd fanqie-workbench && npx vitest run tests/agentic/deslop-review-phases.test.ts`

- [ ] 实现 `fanqie-workbench/src/agentic/phases/deslop-chapter.ts`：

```ts
import type { Phase } from './phase.js'

export const deslopChapterPhase: Phase = {
  name: 'deslop-chapter',
  tools: ['read_file', 'write_file'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文润色助手，正在为《${ctx.bookMeta.title}》第${chapter.chapterNumber}章「${chapter.title}」去 AI 味。`,
      `bookRoot = ${ctx.bookRoot}`,
      `目标文件路径 = ${chapter.sourcePath}`,
      ``,
      `要求：`,
      `1. 用 read_file 读当前正文 ${chapter.sourcePath}。`,
      `2. 清除模板化、AI 腔的句式（"不仅...而且"、"在那一刻"、"心中暗想"、过度排比与总结句），让文字回归自然口语化的网文叙述。`,
      `3. 只改文风，不改剧情、人物与信息量。`,
      `4. 最后用 write_file 工具把润色后的完整正文覆盖写回 ${chapter.sourcePath}。`,
      `5. 不要 ask_user，所有决定独立做。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return `请对第${chapter.chapterNumber}章正文去 AI 味，写完后用 write_file 覆盖写入 ${chapter.sourcePath}。`
  },
  async onComplete(_ctx, _result) {
    return { deslopped: true }
  },
}
```

- [ ] 实现 `fanqie-workbench/src/agentic/phases/review-chapter.ts`：

```ts
import type { Phase } from './phase.js'

export const reviewChapterPhase: Phase = {
  name: 'review-chapter',
  tools: ['read_file', 'list_dir'],
  maxIterations: 6,
  systemPrompt(ctx) {
    const chapter = ctx.chapter!
    return [
      `你是网文审稿助手，正在审查《${ctx.bookMeta.title}》第${chapter.chapterNumber}章「${chapter.title}」。`,
      `bookRoot = ${ctx.bookRoot}`,
      `审查目标文件 = ${chapter.sourcePath}`,
      ``,
      `要求：`,
      `1. 用 read_file 读正文 ${chapter.sourcePath}，必要时用 list_dir / read_file 参考 设定/、大纲/、追踪/。`,
      `2. 只读不写：本阶段不修改任何文件。`,
      `3. 输出一份审查意见，覆盖：剧情连贯性、人设一致性、节奏与爽点、伏笔回收、明显 bug 或硬伤。`,
      `4. 审查意见请直接作为最终回复输出，不要 ask_user。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    const chapter = ctx.chapter!
    return `请审查第${chapter.chapterNumber}章正文，输出审查意见。`
  },
  async onComplete(_ctx, result) {
    return { reviewNotes: result.content }
  },
}
```

- [ ] 运行测试，确认 PASS：`cd fanqie-workbench && npx vitest run tests/agentic/deslop-review-phases.test.ts`

- [ ] 提交：

```
git add fanqie-workbench/src/agentic/phases/deslop-chapter.ts fanqie-workbench/src/agentic/phases/review-chapter.ts fanqie-workbench/tests/agentic/deslop-review-phases.test.ts
git commit -m "feat(agentic): add minimal deslop-chapter and review-chapter phases

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — action-router 注册新 actionKey

实现 spec G 的 `ACTION_PHASES` 增补：`chapter.outline` / `chapter.revise` / `chapter.deslop` / `chapter.review` / `chapter.next`，未知 action 仍抛错。

**Files:**
- `fanqie-workbench/src/agentic/action-router.ts` (修改)
- `fanqie-workbench/tests/agentic/action-router.test.ts` (修改)

步骤：

- [ ] 在 `fanqie-workbench/tests/agentic/action-router.test.ts` 的 `describe('action-router', ...)` 内、`it('throws on unknown action', ...)` 之前追加以下用例（保留现有用例不动）：

```ts
  it('routes chapter.outline to load-context + write-outline', () => {
    expect(routeAction('chapter.outline').map((p) => p.name)).toEqual([
      'load-context',
      'write-outline',
    ])
  })

  it('routes chapter.revise to load-context + revise-chapter', () => {
    expect(routeAction('chapter.revise').map((p) => p.name)).toEqual([
      'load-context',
      'revise-chapter',
    ])
  })

  it('routes chapter.deslop to load-context + deslop-chapter', () => {
    expect(routeAction('chapter.deslop').map((p) => p.name)).toEqual([
      'load-context',
      'deslop-chapter',
    ])
  })

  it('routes chapter.review to load-context + review-chapter', () => {
    expect(routeAction('chapter.review').map((p) => p.name)).toEqual([
      'load-context',
      'review-chapter',
    ])
  })

  it('routes chapter.next to the four-phase one-shot pipeline', () => {
    expect(routeAction('chapter.next').map((p) => p.name)).toEqual([
      'load-context',
      'write-outline',
      'write-chapter',
      'update-tracking',
    ])
  })
```

- [ ] 运行测试，确认 FAIL：`cd fanqie-workbench && npx vitest run tests/agentic/action-router.test.ts`

- [ ] 实现 `fanqie-workbench/src/agentic/action-router.ts`（整文件替换）：

```ts
import { loadContextPhase } from './phases/load-context.js'
import { checkMaterialsPhase } from './phases/check-materials.js'
import { writeChapterPhase } from './phases/write-chapter.js'
import { updateTrackingPhase } from './phases/update-tracking.js'
import { writeOutlinePhase } from './phases/write-outline.js'
import { reviseChapterPhase } from './phases/revise-chapter.js'
import { deslopChapterPhase } from './phases/deslop-chapter.js'
import { reviewChapterPhase } from './phases/review-chapter.js'
import { clarifyDirectionPhase } from './phases/clarify-direction.js'
import { scaffoldBookPhase } from './phases/scaffold-book.js'
import type { Phase } from './phases/phase.js'

const ACTION_PHASES: Record<string, Phase[]> = {
  'chapter.continue': [loadContextPhase, checkMaterialsPhase, writeChapterPhase, updateTrackingPhase],
  'chapter.outline': [loadContextPhase, writeOutlinePhase],
  'chapter.revise': [loadContextPhase, reviseChapterPhase],
  'chapter.deslop': [loadContextPhase, deslopChapterPhase],
  'chapter.review': [loadContextPhase, reviewChapterPhase],
  'chapter.next': [loadContextPhase, writeOutlinePhase, writeChapterPhase, updateTrackingPhase],
  'book.create': [clarifyDirectionPhase, scaffoldBookPhase],
}

export function routeAction(actionKey: string): Phase[] {
  const phases = ACTION_PHASES[actionKey]
  if (!phases) throw new Error(`unknown action: ${actionKey}`)
  return phases
}

export function listActions(): string[] {
  return Object.keys(ACTION_PHASES)
}
```

- [ ] 运行测试，确认 PASS：`cd fanqie-workbench && npx vitest run tests/agentic/action-router.test.ts`

- [ ] 提交：

```
git add fanqie-workbench/src/agentic/action-router.ts fanqie-workbench/tests/agentic/action-router.test.ts
git commit -m "feat(agentic): register chapter.outline/revise/deslop/review/next actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — runner `initialResults` 支持

实现 spec G 的「runner 支持初始 `previousPhaseResults`」：在 `AgentRunnerOptions` 加可选 `initialResults?: Record<string, unknown>`，runner 在 phase 循环开始前把它合并进 `previousPhaseResults`。不传时行为不变 (chapter.continue 回归)。

**Files:**
- `fanqie-workbench/src/agentic/agent-runner.ts` (修改)
- `fanqie-workbench/tests/agentic/agent-runner-initial-results.test.ts` (新建)

步骤：

- [ ] 写失败测试 `fanqie-workbench/tests/agentic/agent-runner-initial-results.test.ts`：

```ts
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { createAgentRunner } from '../../src/agentic/agent-runner.js'
import { createToolRegistry } from '../../src/agentic/tools/tool.js'
import { createTraceStore } from '../../src/agentic/trace-store.js'
import type { LlmProvider } from '../../src/agentic/providers/provider.js'
import type { Phase } from '../../src/agentic/phases/phase.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}

function makePhase(name: string, overrides: Partial<Phase> = {}): Phase {
  return {
    name,
    tools: [],
    maxIterations: 2,
    systemPrompt: () => 'sys',
    initialUserMessage: () => 'user',
    ...overrides,
  }
}

describe('createAgentRunner initialResults', () => {
  let db: Database.Database
  let traceStore: ReturnType<typeof createTraceStore>
  let toolRegistry: ReturnType<typeof createToolRegistry>
  let emitter: EventEmitter

  beforeEach(() => {
    db = memDb()
    traceStore = createTraceStore(db)
    toolRegistry = createToolRegistry()
    emitter = new EventEmitter()
  })

  function makeRunner(phases: Phase[], provider: LlmProvider, initialResults?: Record<string, unknown>) {
    return createAgentRunner({
      bookId: 'b1', chapterId: 'c1',
      bookMeta: { id: 'b1', title: 'T', rootPath: '/tmp/x' },
      chapter: { id: 'c1', chapterNumber: 1, title: 'C1', sourcePath: '/tmp/x/正文/第001章.md', stage: 's' },
      phases,
      actionKey: 'chapter.revise',
      provider,
      toolRegistry,
      traceStore,
      sessionId: 's1',
      model: 'm',
      emitter,
      initialResults,
    })
  }

  it('seeds previousPhaseResults so the first phase can read the value', async () => {
    let captured = ''
    const phase = makePhase('a', {
      initialUserMessage: (ctx) => `inst=${ctx.previousPhaseResults.reviseInstruction}`,
    })
    const provider: LlmProvider = {
      name: 'fake',
      async chat(req) {
        captured = req.messages.find((m) => m.role === 'user')?.content ?? ''
        return { content: 'ok', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 }, finishReason: 'stop' }
      },
    }
    const runner = makeRunner([phase], provider, { reviseInstruction: '改得更狠' })
    await runner.start()
    expect(captured).toContain('inst=改得更狠')
  })

  it('behaves unchanged when initialResults is omitted', async () => {
    let captured = 'unset'
    const phase = makePhase('a', {
      initialUserMessage: (ctx) => `inst=${ctx.previousPhaseResults.reviseInstruction ?? 'none'}`,
    })
    const provider: LlmProvider = {
      name: 'fake',
      async chat(req) {
        captured = req.messages.find((m) => m.role === 'user')?.content ?? ''
        return { content: 'ok', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 }, finishReason: 'stop' }
      },
    }
    const runner = makeRunner([phase], provider)
    await runner.start()
    expect(captured).toContain('inst=none')
  })
})
```

- [ ] 运行测试，确认 FAIL：`cd fanqie-workbench && npx vitest run tests/agentic/agent-runner-initial-results.test.ts`（`initialResults` 不是合法选项 / 值未透传）

- [ ] 在 `fanqie-workbench/src/agentic/agent-runner.ts` 的 `AgentRunnerOptions` interface 内、`onAskUserPending?` 一行下方新增字段：

```ts
  onAskUserPending?: (pending: boolean) => void
  /** Optional seed for previousPhaseResults, merged in before the first phase runs (e.g. reviseInstruction). */
  initialResults?: Record<string, unknown>
```

- [ ] 在同文件中，把 `const previousPhaseResults: Record<string, unknown> = {}` 改为预置 `initialResults`：

```ts
  const previousPhaseResults: Record<string, unknown> = { ...(opts.initialResults ?? {}) }
```

- [ ] 运行测试，确认 PASS：`cd fanqie-workbench && npx vitest run tests/agentic/agent-runner-initial-results.test.ts`

- [ ] 运行回归，确认现有 runner 测试仍 PASS：`cd fanqie-workbench && npx vitest run tests/agentic/agent-runner.test.ts`

- [ ] 提交：

```
git add fanqie-workbench/src/agentic/agent-runner.ts fanqie-workbench/tests/agentic/agent-runner-initial-results.test.ts
git commit -m "feat(agentic): runner supports initialResults seeding previousPhaseResults

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — pool + service 透传 `initialResults`

把 `initialResults` 从 `AgentStartInput` (service) 经 `PoolStartInput` (pool) 传到 `createAgentRunner`。这一层是纯管道，由 Task 7 的 route 测试端到端验证；本 task 只做类型/赋值改动并靠 typecheck + 已有套件回归保证。

**Files:**
- `fanqie-workbench/src/agentic/agent-runner-pool.ts` (修改)
- `fanqie-workbench/src/agentic/agent-service.ts` (修改)

步骤：

- [ ] 在 `fanqie-workbench/src/agentic/agent-runner-pool.ts` 的 `PoolStartInput` interface 末尾（`emitter: EventEmitter` 之后）新增：

```ts
  emitter: EventEmitter
  initialResults?: Record<string, unknown>
```

- [ ] 在同文件 `createAgentRunner({ ... })` 调用里，`emitter: input.emitter,` 之后新增一行：

```ts
        emitter: input.emitter,
        initialResults: input.initialResults,
```

- [ ] 在 `fanqie-workbench/src/agentic/agent-service.ts` 的 `AgentStartInput` interface 末尾（`emitter: EventEmitter` 之后）新增：

```ts
  emitter: EventEmitter
  initialResults?: Record<string, unknown>
```

- [ ] 在同文件 `pool.start({ ... })` 调用里，`emitter: input.emitter,` 之后新增一行：

```ts
        emitter: input.emitter,
        initialResults: input.initialResults,
```

- [ ] 运行回归，确认相关套件 PASS：`cd fanqie-workbench && npx vitest run tests/agentic/agent-runner.test.ts tests/agentic/agent-runner-initial-results.test.ts tests/server/agent-sessions-route.test.ts`

- [ ] 提交：

```
git add fanqie-workbench/src/agentic/agent-runner-pool.ts fanqie-workbench/src/agentic/agent-service.ts
git commit -m "feat(agentic): thread initialResults through pool and service

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — `/api/agent-sessions` 接受可选 `instruction`

实现 spec G 的 instruction 透传：`POST /api/agent-sessions` body 增加可选 `instruction?: string`，route 把它放进 `AgentStartInput.initialResults = { reviseInstruction: instruction }`。无 instruction 时不带 `initialResults`（保持现有行为）。

**Files:**
- `fanqie-workbench/src/server/routes/agent-sessions.ts` (修改)
- `fanqie-workbench/tests/server/agent-sessions-route.test.ts` (修改)

步骤：

- [ ] 在 `fanqie-workbench/tests/server/agent-sessions-route.test.ts` 的 `describe('agent-sessions route', ...)` 内、`it('starts a session and returns sessionId', ...)` 之后追加两个用例。沿用现有文件里的 `fakeService` / `memDb()` 约定，用闭包变量捕获 `start` 入参（不要假设 service 上有 `lastStart` 字段；现有 beforeEach 已插入 `b1`/`c1`）：

```ts
  it('passes instruction through to the agent as reviseInstruction', async () => {
    let started: any = null
    service = fakeService({ start: async (input) => { started = input; return { status: 'running', currentPhase: null, traceId: 9, start: async () => {}, cancel: () => {}, submitAnswer: () => {} } as AgentRunner } })
    const freshApp = Fastify()
    registerAgentSessionsRoutes(freshApp, { db, service })
    const res = await freshApp.inject({
      method: 'POST',
      url: '/api/agent-sessions',
      payload: { actionKey: 'chapter.revise', bookId: 'b1', chapterId: 'c1', instruction: '把结尾改得更悬疑' },
    })
    expect(res.statusCode).toBe(200)
    expect(started.initialResults).toEqual({ reviseInstruction: '把结尾改得更悬疑' })
  })

  it('does not set initialResults when no instruction is provided', async () => {
    let started: any = null
    service = fakeService({ start: async (input) => { started = input; return { status: 'running', currentPhase: null, traceId: 9, start: async () => {}, cancel: () => {}, submitAnswer: () => {} } as AgentRunner } })
    const freshApp = Fastify()
    registerAgentSessionsRoutes(freshApp, { db, service })
    const res = await freshApp.inject({
      method: 'POST',
      url: '/api/agent-sessions',
      payload: { actionKey: 'chapter.continue', bookId: 'b1', chapterId: 'c1' },
    })
    expect(res.statusCode).toBe(200)
    expect(started.initialResults).toBeUndefined()
  })
```

- [ ] 运行测试，确认 FAIL：`cd fanqie-workbench && npx vitest run tests/server/agent-sessions-route.test.ts`

- [ ] 在 `fanqie-workbench/src/server/routes/agent-sessions.ts` 修改 `/api/agent-sessions` handler。把路由泛型与解构改为带 `instruction`，并把 `initialResults` 传入 `deps.service.start`：

把
```ts
  app.post<{ Body: { actionKey: string; bookId: string; chapterId: string } }>(
    '/api/agent-sessions',
    async (req, reply) => {
      const { actionKey, bookId, chapterId } = req.body
```
改为
```ts
  app.post<{ Body: { actionKey: string; bookId: string; chapterId: string; instruction?: string } }>(
    '/api/agent-sessions',
    async (req, reply) => {
      const { actionKey, bookId, chapterId, instruction } = req.body
```

并把该 handler 内的
```ts
        const runner = await deps.service.start({
          actionKey,
          bookMeta: { id: book.id, title: book.title, rootPath: book.root_path },
          chapter: {
            id: chapter.id, chapterNumber: chapter.chapter_number, title: chapter.title,
            sourcePath: chapter.source_path, stage: chapter.stage,
          },
          sessionId, emitter,
        })
```
改为
```ts
        const runner = await deps.service.start({
          actionKey,
          bookMeta: { id: book.id, title: book.title, rootPath: book.root_path },
          chapter: {
            id: chapter.id, chapterNumber: chapter.chapter_number, title: chapter.title,
            sourcePath: chapter.source_path, stage: chapter.stage,
          },
          sessionId, emitter,
          ...(instruction ? { initialResults: { reviseInstruction: instruction } } : {}),
        })
```

- [ ] 运行测试，确认 PASS：`cd fanqie-workbench && npx vitest run tests/server/agent-sessions-route.test.ts`

- [ ] 提交：

```
git add fanqie-workbench/src/server/routes/agent-sessions.ts fanqie-workbench/tests/server/agent-sessions-route.test.ts
git commit -m "feat(server): /agent-sessions accepts optional instruction as reviseInstruction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — `POST /api/agent-sessions/chapter-next` 新端点

实现 spec H：计算 `next = max(chapter_number) + 1`（无章则 0+1=1），写占位正文文件，插入 chapters 行（source_path 用**绝对路径** `join(bookRoot, '正文', \`第${NNN}章.md\`)`），启动 `actionKey='chapter.next'` agent，返回 `{ sessionId, chapterId, status, traceId }`。复用模块级 `sessionEmitters` / `sessionToBook` / 路由级 `activeBookIds`。

**Files:**
- `fanqie-workbench/src/server/routes/agent-sessions.ts` (修改)
- `fanqie-workbench/tests/server/agent-sessions-chapter-next.test.ts` (新建)

步骤：

- [ ] 写失败测试 `fanqie-workbench/tests/server/agent-sessions-chapter-next.test.ts`：

```ts
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schemaSql } from '../../src/db/schema.js'
import { registerAgentSessionsRoutes } from '../../src/server/routes/agent-sessions.js'
import type { AgentService } from '../../src/agentic/agent-service.js'
import type { AgentRunner } from '../../src/agentic/agent-runner.js'

function memDb() {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  return db
}

function fakeService(overrides: Partial<AgentService> = {}): AgentService {
  return {
    start: async () => ({ status: 'running', currentPhase: null, traceId: 7, start: async () => {}, cancel: () => {}, submitAnswer: () => {} } as AgentRunner),
    cancel: () => {},
    get: () => null,
    submitAnswer: () => {},
    ...overrides,
  }
}

describe('agent-sessions chapter-next route', () => {
  let db: Database.Database
  let bookRoot: string

  beforeEach(() => {
    db = memDb()
    bookRoot = mkdtempSync(join(tmpdir(), 'cn-'))
  })

  afterEach(() => {
    db.close()
    rmSync(bookRoot, { recursive: true, force: true })
  })

  it('returns 404 for missing book', async () => {
    const app = Fastify()
    registerAgentSessionsRoutes(app, { db, service: fakeService() })
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/chapter-next', payload: { bookId: 'nope' } })
    expect(res.statusCode).toBe(404)
  })

  it('creates the next chapter (1 when none) with absolute source_path and starts chapter.next', async () => {
    let started: any = null
    const service = fakeService({ start: async (input) => { started = input; return { status: 'running', currentPhase: null, traceId: 7, start: async () => {}, cancel: () => {}, submitAnswer: () => {} } as AgentRunner } })
    const app = Fastify()
    registerAgentSessionsRoutes(app, { db, service })

    const bookId = 'book-cn-1'
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)`).run(bookId, '测试书', bookRoot)
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/chapter-next', payload: { bookId } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.sessionId).toBeTruthy()
    expect(body.chapterId).toBeTruthy()
    expect(body.traceId).toBe(7)

    const expectedPath = join(bookRoot, '正文', '第001章.md')
    const row: any = db.prepare(`SELECT * FROM chapters WHERE id = ?`).get(body.chapterId)
    expect(row.chapter_number).toBe(1)
    expect(row.source_path).toBe(expectedPath)
    expect(existsSync(expectedPath)).toBe(true)
    expect(readFileSync(expectedPath, 'utf8')).toContain('第1章')

    expect(started.actionKey).toBe('chapter.next')
    expect(started.chapter.chapterNumber).toBe(1)
    expect(started.chapter.sourcePath).toBe(expectedPath)
  })

  it('computes next = max + 1 when chapters exist', async () => {
    const app = Fastify()
    registerAgentSessionsRoutes(app, { db, service: fakeService() })

    const bookId = 'book-cn-2'
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES (?, ?, ?)`).run(bookId, '测试书2', bookRoot)
    db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('c1', bookId, 3, '第三章', join(bookRoot, '正文', '第003章.md'), '已写作')
    const res = await app.inject({ method: 'POST', url: '/api/agent-sessions/chapter-next', payload: { bookId } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const row: any = db.prepare(`SELECT * FROM chapters WHERE id = ?`).get(body.chapterId)
    expect(row.chapter_number).toBe(4)
    expect(row.source_path).toBe(join(bookRoot, '正文', '第004章.md'))
  })
})
```

- [ ] 运行测试，确认 FAIL：`cd fanqie-workbench && npx vitest run tests/server/agent-sessions-chapter-next.test.ts`（端点 404 / 不存在）

- [ ] 在 `fanqie-workbench/src/server/routes/agent-sessions.ts` 顶部 import 增加 `writeFile`（已有 `mkdir`）：

把
```ts
import { mkdir } from 'node:fs/promises'
```
改为
```ts
import { mkdir, writeFile } from 'node:fs/promises'
```

- [ ] 在 `registerAgentSessionsRoutes` 函数体内、`/api/agent-sessions/book-create` 端点之后（`)` 结束、`}` 函数结束之前）新增 `/chapter-next` 端点：

```ts
  app.post<{ Body: { bookId: string } }>(
    '/api/agent-sessions/chapter-next',
    async (req, reply) => {
      const { bookId } = req.body
      if (activeBookIds.has(bookId)) {
        return reply.code(409).send({ error: `book ${bookId} already running` })
      }
      const book: any = deps.db.prepare(`SELECT id, title, root_path FROM books WHERE id = ?`).get(bookId)
      if (!book) return reply.code(404).send({ error: 'book not found' })

      const maxRow: any = deps.db
        .prepare(`SELECT MAX(chapter_number) AS maxNum FROM chapters WHERE book_id = ?`)
        .get(bookId)
      const next = (maxRow?.maxNum ?? 0) + 1
      const nnn = String(next).padStart(3, '0')
      const sourcePath = join(book.root_path, '正文', `第${nnn}章.md`)

      await mkdir(join(book.root_path, '正文'), { recursive: true })
      await writeFile(sourcePath, `# 第${next}章\n<!-- 正文待 agent 续写 -->\n`, 'utf8')

      const chapterId = randomUUID()
      deps.db
        .prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(chapterId, bookId, next, `第${next}章`, sourcePath, '待写作')

      const sessionId = randomUUID()
      const emitter = new EventEmitter()
      sessionEmitters.set(sessionId, emitter)
      sessionToBook.set(sessionId, bookId)
      activeBookIds.add(bookId)
      emitter.on('event', (ev: any) => {
        if (ev.type === 'done') activeBookIds.delete(bookId)
      })

      try {
        const runner = await deps.service.start({
          actionKey: 'chapter.next',
          bookMeta: { id: book.id, title: book.title, rootPath: book.root_path },
          chapter: {
            id: chapterId, chapterNumber: next, title: `第${next}章`,
            sourcePath, stage: '待写作',
          },
          sessionId, emitter,
        })
        return { sessionId, chapterId, status: runner.status, traceId: runner.traceId }
      } catch (err: any) {
        sessionEmitters.delete(sessionId)
        sessionToBook.delete(sessionId)
        activeBookIds.delete(bookId)
        if (/already running|concurrent limit/i.test(err.message)) {
          return reply.code(409).send({ error: err.message })
        }
        return reply.code(500).send({ error: err.message })
      }
    },
  )
```

- [ ] 运行测试，确认 PASS：`cd fanqie-workbench && npx vitest run tests/server/agent-sessions-chapter-next.test.ts`

- [ ] 运行回归，确认其它 agent-sessions 套件 PASS：`cd fanqie-workbench && npx vitest run tests/server/agent-sessions-route.test.ts tests/server/book-create-route.test.ts tests/server/book-create-chapter-bootstrap.test.ts`

- [ ] 提交：

```
git add fanqie-workbench/src/server/routes/agent-sessions.ts fanqie-workbench/tests/server/agent-sessions-chapter-next.test.ts
git commit -m "feat(server): add POST /api/agent-sessions/chapter-next endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — 工作台 UI：编剧本章 / AI 改稿本章 / 写下一章

实现 spec I：动作按钮行新增「编剧本章」(`chapter.outline`)、「AI 改稿本章」（点开 inline 指令输入框，填指令后 POST `chapter.revise` 带 `instruction`）、「写下一章」（POST `/api/agent-sessions/chapter-next` 然后 `load()` 并选中新章）。

**Files:**
- `fanqie-workbench/src/web/pages/book-workspace-page.tsx` (修改)
- `fanqie-workbench/tests/web/book-workspace-page.test.tsx` (修改)

步骤：

- [ ] 在 `fanqie-workbench/tests/web/book-workspace-page.test.tsx` 的 `describe('BookWorkspacePage writing loop', ...)` 内追加 4 个用例。沿用文件已有约定：每个 `it` 自带 `(globalThis as any).fetch = vi.fn(...)` 内联 mock、复用顶部已声明的 `detailWithChapter()` 助手与 `MockWebSocket`、用 `findByText` 等待章节渲染（章节标题为 `detailWithChapter()` 默认的「雾夜失踪」）。注意 import 已含 `fireEvent`/`waitFor`/`vi`：

```ts
  it('renders the new chapter action buttons', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      throw new Error(`unexpected fetch ${input}`)
    })
    render(<BookWorkspacePage bookId="book-1" />)
    expect(await screen.findByText('编剧本章')).toBeTruthy()
    expect(screen.getByText('AI 改稿本章')).toBeTruthy()
    expect(screen.getByText('写下一章')).toBeTruthy()
  })

  it('triggers chapter.outline action', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      if (input === '/api/agent-sessions' && init?.method === 'POST') return { ok: true, json: async () => ({ sessionId: 'session-1', status: 'running', traceId: 1 }) }
      throw new Error(`unexpected fetch ${input}`)
    })
    ;(globalThis as any).fetch = fetchMock
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('编剧本章'))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c: any[]) => c[0] === '/api/agent-sessions' && c[1]?.method === 'POST' && JSON.parse(c[1].body).actionKey === 'chapter.outline')
      expect(call).toBeTruthy()
    })
  })

  it('opens an instruction input and submits chapter.revise with instruction', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      if (input === '/api/agent-sessions' && init?.method === 'POST') return { ok: true, json: async () => ({ sessionId: 'session-1', status: 'running', traceId: 1 }) }
      throw new Error(`unexpected fetch ${input}`)
    })
    ;(globalThis as any).fetch = fetchMock
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('AI 改稿本章'))
    const input = await screen.findByPlaceholderText('输入改稿指令，例如：把结尾改得更悬疑') as HTMLInputElement
    fireEvent.change(input, { target: { value: '把男主写得更狠' } })
    fireEvent.click(screen.getByText('提交改稿'))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c: any[]) => c[0] === '/api/agent-sessions' && c[1]?.method === 'POST' && JSON.parse(c[1].body).actionKey === 'chapter.revise')
      expect(call).toBeTruthy()
      expect(JSON.parse(call![1].body).instruction).toBe('把男主写得更狠')
    })
  })

  it('triggers chapter-next endpoint when 写下一章 clicked', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/books/book-1') return { ok: true, json: async () => detailWithChapter() }
      if (input === '/api/books/book-1/sessions') return { ok: true, json: async () => ({ sessions: [] }) }
      if (input === '/api/books/book-1/publications') return { ok: true, json: async () => ({ publications: [] }) }
      if (input === '/api/chapters/chapter-1/content') return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '# 第1章 雾夜失踪' }) }
      if (input === '/api/agent-sessions/chapter-next' && init?.method === 'POST') return { ok: true, json: async () => ({ sessionId: 'session-next', chapterId: 'chapter-2', status: 'running', traceId: 2 }) }
      throw new Error(`unexpected fetch ${input}`)
    })
    ;(globalThis as any).fetch = fetchMock
    render(<BookWorkspacePage bookId="book-1" />)
    fireEvent.click(await screen.findByText('写下一章'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/agent-sessions/chapter-next', expect.objectContaining({ method: 'POST' }))
    })
  })
```

- [ ] 运行测试，确认 FAIL：`cd fanqie-workbench && npx vitest run tests/web/book-workspace-page.test.tsx`

- [ ] 在 `fanqie-workbench/src/web/pages/book-workspace-page.tsx` 增加状态。把
```ts
  const [editorReloadKey, setEditorReloadKey] = useState(0)
```
改为
```ts
  const [editorReloadKey, setEditorReloadKey] = useState(0)
  const [reviseOpen, setReviseOpen] = useState(false)
  const [reviseInstruction, setReviseInstruction] = useState('')
```

- [ ] 在同文件 `startAction` 之后、`refreshAfterSessionChange` 之前新增两个 handler：

```ts
  const submitRevise = async () => {
    if (!selectedChapterId || !reviseInstruction.trim()) return
    setActionError(null)
    const response = await fetch('/api/agent-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionKey: 'chapter.revise', bookId, chapterId: selectedChapterId, instruction: reviseInstruction.trim() }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionError(body.error || '启动失败')
      return
    }
    setActiveSessionId(body.sessionId)
    setReviseOpen(false)
    setReviseInstruction('')
  }

  const writeNextChapter = async () => {
    setActionError(null)
    const response = await fetch('/api/agent-sessions/chapter-next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionError(body.error || '启动失败')
      return
    }
    setActiveSessionId(body.sessionId)
    await load(true)
    if (body.chapterId) setSelectedChapterId(body.chapterId)
  }
```

- [ ] 在同文件按钮行（`继续写本章` 所在的 `div`）内、`审稿本章` 按钮之后新增三个按钮，并在该 `div` 之后渲染 inline 改稿输入框。把
```tsx
            <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.md }}>
              <button onClick={() => void startAction('chapter.continue')} disabled={!selectedChapter}>继续写本章</button>
              <button onClick={() => void startAction('chapter.deslop')} disabled={!selectedChapter}>去 AI 味本章</button>
              <button onClick={() => void startAction('chapter.review')} disabled={!selectedChapter}>审稿本章</button>
            </div>
```
改为
```tsx
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
              <button onClick={() => void startAction('chapter.continue')} disabled={!selectedChapter}>继续写本章</button>
              <button onClick={() => void startAction('chapter.outline')} disabled={!selectedChapter}>编剧本章</button>
              <button onClick={() => void startAction('chapter.deslop')} disabled={!selectedChapter}>去 AI 味本章</button>
              <button onClick={() => void startAction('chapter.review')} disabled={!selectedChapter}>审稿本章</button>
              <button onClick={() => setReviseOpen((v) => !v)} disabled={!selectedChapter}>AI 改稿本章</button>
              <button onClick={() => void writeNextChapter()}>写下一章</button>
            </div>
            {reviseOpen && (
              <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.md }}>
                <input
                  value={reviseInstruction}
                  onChange={(e) => setReviseInstruction(e.target.value)}
                  placeholder="输入改稿指令，例如：把结尾改得更悬疑"
                  style={{ flex: 1, padding: spacing.sm, borderRadius: radius.md, border: '1px solid var(--border)' }}
                />
                <button onClick={() => void submitRevise()} disabled={!reviseInstruction.trim()}>提交改稿</button>
              </div>
            )}
```

- [ ] 运行测试，确认 PASS：`cd fanqie-workbench && npx vitest run tests/web/book-workspace-page.test.tsx`

- [ ] 提交：

```
git add fanqie-workbench/src/web/pages/book-workspace-page.tsx fanqie-workbench/tests/web/book-workspace-page.test.tsx
git commit -m "feat(web): add 编剧本章/AI改稿本章/写下一章 actions to workspace

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10 — 手动编辑入口确认（spec I 的 a）

spec I 明确：手动编辑已有 `ChapterEditor`（`ChapterContentEditor`），只需确认保存按钮可用，不新增代码。本 task 是验证而非实现——若保存按钮已存在且 `chapter-content` PUT 端点工作，无代码改动。

**Files:**
- `fanqie-workbench/src/web/components/chapter-editor.tsx` (只读确认)
- `fanqie-workbench/tests/web/chapter-editor.test.tsx` (运行确认)
- `fanqie-workbench/tests/server/chapter-content-route.test.ts` (运行确认)

步骤：

- [ ] 阅读 `fanqie-workbench/src/web/components/chapter-editor.tsx`，确认存在「保存」按钮且 `onClick` 调用 `PUT /api/chapters/:chapterId/content`，并在工作台已通过 `<ChapterEditor ... onSaved={() => void load()} />` 接线（已存在于 `book-workspace-page.tsx`）。注：现有 `tests/web/book-workspace-page.test.tsx` 的「loads real editor, edits, and saves chapter content」用例已断言点击「保存」触发 `PUT /api/chapters/chapter-1/content`，即手动编辑闭环已被覆盖。

- [ ] 运行已有的编辑器 + 内容端点测试，确认保存路径仍 PASS：`cd fanqie-workbench && npx vitest run tests/web/chapter-editor.test.tsx tests/server/chapter-content-route.test.ts`

- [ ] 若保存按钮缺失：仅补一个调用现有 PUT 的「保存」按钮（最小改动），并加一条 RTL 测试断言点击触发 `PUT`；随后 commit。**若已存在则跳过本步，无 commit。** 判断标准：上一步阅读到了带「保存」字样、绑定 PUT 的按钮即视为已存在。

- [ ] （仅在有改动时）提交：

```
git add fanqie-workbench/src/web/components/chapter-editor.tsx fanqie-workbench/tests/web/chapter-editor.test.tsx
git commit -m "fix(web): ensure manual chapter editor save button works

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11 — 全量回归（验收标准：`npm test` 不回归）

**Files:** 无（仅运行）

步骤：

- [ ] 运行整套测试：`cd fanqie-workbench && npx vitest run`

- [ ] 确认全绿。若有失败，用 superpowers:systematic-debugging 定位修复后重跑，不得跳过。

- [ ] 对照 spec 第二部分验收标准逐条自检：
  - 选中一章点「编剧本章」→ `chapter.outline` 跑通生成 `大纲/细纲_第NNN章.md`（Task 1 + 4 + 9）
  - 点「写下一章」→ 列表多一章、自动选中、细纲+正文都生成（Task 8 + 9）
  - 点「AI 改稿本章」→ 填指令 → 正文按指令变化（Task 2 + 5/6/7 + 9）
  - 点「去 AI 味本章 / 审稿本章」不再报 `unknown action`（Task 3 + 4）
  - 手动在编辑器改正文能保存（Task 10）
  - `npm test` 不回归（本 task）

- [ ] 若上述任一步在 Task 中遗漏，回到对应 Task 补齐后重跑 Task 11。

---

## 自检 (against spec part 2 F–I + 测试策略 + 验收标准)

- F `write-outline`：Task 1，tools/maxIterations/路径全覆盖。✓
- F `revise-chapter`：Task 2，从 `reviseInstruction` 取指令、覆盖 sourcePath、空指令不报错。✓
- G `deslop`/`review` 最小 phase：Task 3。✓
- G action-router 注册（含 `chapter.next` 内部序列）：Task 4。✓
- G runner `initialResults`：Task 5（含「不传时行为不变」回归）。✓
- G pool/service 透传：Task 6。✓
- G `/agent-sessions` instruction：Task 7。✓
- H `/chapter-next` 端点（next 计算、占位文件、绝对 source_path、启动 agent、返回值）：Task 8。✓
- I UI 三按钮 + inline 指令框 + 写下一章后刷新选中：Task 9。✓
- I 手动编辑确认：Task 10。✓
- 测试策略表 7 行全部映射到 test-first task（write-outline / revise-chapter / action-router / runner initialResults / chapter-next / agent-sessions instruction / book-workspace-page）。✓
- 验收标准「npm test 不回归」：Task 11。✓
- 类型/命名一致性：`initialResults` / `reviseInstruction` / `writeOutlinePhase` 等跨 task 统一；ESM `.js` import 后缀；padStart(3,'0') 路径约定一致。✓
- 无 TODO / 占位 / "similar to"：每步给出完整代码。✓
