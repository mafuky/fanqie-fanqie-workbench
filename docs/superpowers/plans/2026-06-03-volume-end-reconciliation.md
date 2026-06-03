# 卷末对账(Volume-End Reconciliation)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 写到卷末时,自动对比卷纲计划 vs 各章实际,**仅在有实质偏差时**生成对账报告,经 HITL 确认后 append-only 追加进卷纲。

**Architecture:** 在 `chapter.next`/`chapter.continue` 末尾挂一个**非阻塞**的 `volume-reconcile` phase;它用纯函数(`src/domain/volume.ts`)从卷纲「章节范围」做**确定性闸门**(`Phase.shouldRun` → 非卷末零成本跳过、不调模型),触发后让模型产「偏差报告」,经一个只发事件的工具上抛,路由侧监听器建 review_checkpoint,用户在卡片确认后由 resolve 路由事务内 append。对账任何失败都被 `Phase.nonFatal` 兜住,绝不拖垮日更。

**Tech Stack:** TypeScript/Node, Fastify, React/Vite, better-sqlite3, vitest。

**Spec:** `docs/superpowers/specs/2026-06-03-volume-end-reconciliation-design.md`

**全局约定:**
- 所有命令在 `fanqie-workbench/` 下执行。
- 单测命令:`npx vitest run <path>`;全量:`npx vitest run`。
- 提交前确保 `npx vitest run` 全绿。基线为 388 通过(B1 之后)。

---

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/domain/volume.ts`(新) | 纯函数:中文数字↔int、卷纲文件名解析、章节范围解析、卷末判定 | T1 |
| `src/agentic/phases/phase.ts`(改) | `Phase` 加 `shouldRun?` + `nonFatal?` | T2 |
| `src/agentic/agent-runner.ts`(改) | 支持 `shouldRun` 跳过(不调模型)+ `nonFatal` 兜错 | T2 |
| `src/agentic/events.ts`(改) | `AgentEvent` 加 `review-checkpoint-requested` | T3 |
| `src/agentic/tools/propose-volume-reconcile.ts`(新) | 只 emit 不碰 DB 的提议工具 + 硬校验 | T3 |
| `src/agentic/agent-service.ts`(改) | 注册新工具 | T3 |
| `src/db/schema.ts` + `src/db/client.ts`(改) | `review_checkpoints.payload_json` 列 + 迁移 | T4 |
| `src/db/repositories/review-checkpoints-repo.ts`(改) | 类型/列/map/parsePayload/payload/去重查询 | T4 |
| `src/server/review-checkpoint-service.ts`(改) | `createVolumeReconcileCheckpoint` | T5 |
| `src/agentic/phases/volume-reconcile.ts`(新) | 闸门 + 报告 prompt;`shouldRun`/`nonFatal` | T6 |
| `src/agentic/action-router.ts`(改) | 两条 pipeline 末尾加 phase | T6 |
| `src/server/routes/agent-sessions.ts`(改) | run 启动补建 sessions 行 + `wireReviewCheckpointRequest` | T7 |
| `src/server/routes/review-checkpoints.ts`(改) | 按 stage 分支 + editedText + 落盘 + 幂等 + 越权防护 | T8 |
| `src/web/components/review-checkpoint-card.tsx`(改) | stage 分支 UI + editedText | T9 |

---

## Task 1: `src/domain/volume.ts` 纯函数(卷边界解析)

**Files:**
- Create: `fanqie-workbench/src/domain/volume.ts`
- Test: `fanqie-workbench/tests/domain/volume.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/domain/volume.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  chineseNumeralToInt, parseVolumeFileName, parseVolumeChapterRange, findVolumeEndingAt,
} from '../../src/domain/volume'

describe('chineseNumeralToInt', () => {
  it('parses 一..十 and compound forms', () => {
    expect(chineseNumeralToInt('一')).toBe(1)
    expect(chineseNumeralToInt('十')).toBe(10)
    expect(chineseNumeralToInt('十二')).toBe(12)
    expect(chineseNumeralToInt('二十')).toBe(20)
    expect(chineseNumeralToInt('二十一')).toBe(21)
  })
  it('accepts arabic and rejects junk', () => {
    expect(chineseNumeralToInt('3')).toBe(3)
    expect(chineseNumeralToInt('零零')).toBeNull()
    expect(chineseNumeralToInt('')).toBeNull()
  })
})

describe('parseVolumeFileName', () => {
  it('extracts the volume number from 卷纲_第X卷.md', () => {
    expect(parseVolumeFileName('卷纲_第一卷.md')).toBe(1)
    expect(parseVolumeFileName('卷纲_第十二卷.md')).toBe(12)
  })
  it('returns null for non-volume files', () => {
    expect(parseVolumeFileName('大纲.md')).toBeNull()
    expect(parseVolumeFileName('细纲_第001章.md')).toBeNull()
  })
})

describe('parseVolumeChapterRange', () => {
  it('reads 章节范围 line, tolerant of full/half-width colon and spaces', () => {
    expect(parseVolumeChapterRange('# 第一卷\n章节范围:第1-8章\n## 本卷目标')).toEqual({ start: 1, end: 8 })
    expect(parseVolumeChapterRange('章节范围： 第 9 — 18 章')).toEqual({ start: 9, end: 18 })
  })
  it('ignores other chapter mentions (爽点节奏: 第1-2章) when no 章节范围 line', () => {
    expect(parseVolumeChapterRange('爽点节奏\n- 第1-2章:开篇')).toBeNull()
  })
})

describe('findVolumeEndingAt', () => {
  const vols = [
    { volumeNumber: 1, start: 1, end: 8 },
    { volumeNumber: 2, start: 9, end: 18 },
  ]
  it('returns the volume when N is its last chapter', () => {
    expect(findVolumeEndingAt(8, vols)).toEqual({ volumeNumber: 1, start: 1, end: 8 })
  })
  it('returns null when N is mid-volume', () => {
    expect(findVolumeEndingAt(5, vols)).toBeNull()
  })
  it('returns null when N falls in no / overlapping ranges', () => {
    expect(findVolumeEndingAt(99, vols)).toBeNull()
    expect(findVolumeEndingAt(8, [...vols, { volumeNumber: 9, start: 8, end: 12 }])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/domain/volume.test.ts`
Expected: FAIL — `Cannot find module '../../src/domain/volume'`.

- [ ] **Step 3: Implement**

`src/domain/volume.ts`:
```ts
const DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 一..九十九 与阿拉伯数字 → int;无法解析返回 null。 */
export function chineseNumeralToInt(raw: string): number | null {
  const t = (raw ?? '').trim()
  if (!t) return null
  if (/^\d+$/.test(t)) return Number(t)
  if (t === '十') return 10
  if (t.includes('十')) {
    const [a, b] = t.split('十')
    const tens = a === '' ? 1 : DIGITS[a]
    const ones = b === '' ? 0 : DIGITS[b]
    if (tens == null || ones == null) return null
    return tens * 10 + ones
  }
  if (t.length === 1 && DIGITS[t] != null && t !== '零') return DIGITS[t]
  return null
}

/** 卷纲_第X卷.md → 卷号(X 为中文数字);否则 null。 */
export function parseVolumeFileName(filename: string): number | null {
  const m = filename.match(/^卷纲_第(.+)卷\.md$/)
  return m ? chineseNumeralToInt(m[1]) : null
}

function matchRange(line: string): { start: number; end: number } | null {
  const m = line.match(/第\s*(\d+)\s*[-–—~至]\s*(\d+)\s*章/)
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  if (!(start >= 1) || !(end >= start)) return null
  return { start, end }
}

/** 从卷纲全文取「章节范围」那一行的区间;无该行返回 null(不拿爽点节奏里的章号凑数)。 */
export function parseVolumeChapterRange(volumeText: string): { start: number; end: number } | null {
  for (const line of volumeText.split('\n')) {
    if (line.includes('章节范围')) {
      const r = matchRange(line)
      if (r) return r
    }
  }
  return null
}

export type VolumeRange = { volumeNumber: number; start: number; end: number }

/** N 恰是某卷末章且该卷唯一包含 N → 返回该卷;无匹配/重叠/非末章 → null。 */
export function findVolumeEndingAt(chapterN: number, volumes: VolumeRange[]): VolumeRange | null {
  const containing = volumes.filter((v) => chapterN >= v.start && chapterN <= v.end)
  if (containing.length !== 1) return null
  const v = containing[0]
  return chapterN === v.end ? v : null
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/domain/volume.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/domain/volume.ts tests/domain/volume.test.ts
git commit -m "feat(volume): pure helpers for volume boundary parsing"
```

---

## Task 2: `Phase.shouldRun` + `Phase.nonFatal`(runner 跳过 & 兜错)

**Files:**
- Modify: `fanqie-workbench/src/agentic/phases/phase.ts:28-41`
- Modify: `fanqie-workbench/src/agentic/agent-runner.ts:73-167`
- Test: `fanqie-workbench/tests/agentic/runner-phase-flags.test.ts`

**背景:** 当前 runner 对每个 phase 都跑模型循环,且任一 phase 抛错 → 整 run `failed`(agent-runner.ts:171-182)。需要:(1) `shouldRun(ctx)` 返回 false → 跳过该 phase,**不调模型**;(2) `nonFatal:true` 的 phase 抛错 → 记录但不失败整 run。

- [ ] **Step 1: Write the failing test**

`tests/agentic/runner-phase-flags.test.ts`:
```ts
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createAgentRunner } from '../../src/agentic/agent-runner'
import type { Phase } from '../../src/agentic/phases/phase'

function fakeProvider(calls: string[]) {
  return {
    name: 'fake',
    chat: vi.fn(async () => {
      calls.push('chat')
      return { content: 'ok', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 }, finishReason: 'stop' as const }
    }),
  }
}
const traceStore = {
  createTrace: () => 1, appendEvent: () => {}, addUsage: () => {}, endTrace: () => {},
} as any
const toolRegistry = { listFiltered: () => [], execute: async () => ({ ok: true, result: '' }), list: () => [], register: () => {} } as any

function runnerWith(phases: Phase[], calls: string[]) {
  return createAgentRunner({
    bookId: 'b1', chapterId: 'c1',
    bookMeta: { id: 'b1', title: 'T', rootPath: '/x' },
    chapter: { id: 'c1', chapterNumber: 8, title: 't', sourcePath: 'a.md', stage: '已初稿' },
    phases, actionKey: 'chapter.next',
    provider: fakeProvider(calls) as any, toolRegistry, traceStore,
    sessionId: 's1', model: 'm', emitter: new EventEmitter(),
  })
}

const base: Phase = {
  name: 'p', tools: [], maxIterations: 1,
  systemPrompt: () => 'sys', initialUserMessage: () => 'usr',
}

describe('runner phase flags', () => {
  it('skips a phase whose shouldRun returns false — no model call', async () => {
    const calls: string[] = []
    const r = runnerWith([{ ...base, shouldRun: async () => false }], calls)
    await r.start()
    expect(r.status).toBe('succeeded')
    expect(calls).toEqual([]) // model never called
  })

  it('runs the phase when shouldRun returns true', async () => {
    const calls: string[] = []
    const r = runnerWith([{ ...base, shouldRun: async () => true }], calls)
    await r.start()
    expect(calls).toEqual(['chat'])
  })

  it('a nonFatal phase that throws does not fail the run', async () => {
    const calls: string[] = []
    const boom: Phase = { ...base, nonFatal: true, shouldRun: async () => { throw new Error('boom') } }
    const r = runnerWith([boom], calls)
    await r.start()
    expect(r.status).toBe('succeeded')
  })

  it('a normal phase that throws in shouldRun still fails the run', async () => {
    const calls: string[] = []
    const boom: Phase = { ...base, shouldRun: async () => { throw new Error('boom') } }
    const r = runnerWith([boom], calls)
    await r.start()
    expect(r.status).toBe('failed')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/agentic/runner-phase-flags.test.ts`
Expected: FAIL — `shouldRun`/`nonFatal` not honored (model called when skipped; nonFatal throw fails run).

- [ ] **Step 3: Implement — extend Phase interface**

In `src/agentic/phases/phase.ts`, add to the `Phase` interface (after `verify?`):
```ts
  /**
   * Deterministic gate, run before the model loop. Return false to skip this phase
   * entirely (no model call). Throwing is treated as a real error (run fails) unless
   * the phase is also nonFatal.
   */
  shouldRun?(ctx: PhaseContext): Promise<boolean>
  /**
   * When true, any failure in this phase (shouldRun / model loop / verify / onComplete)
   * is logged and swallowed — the run continues and still succeeds. For non-blocking
   * side-effect phases (e.g. volume-reconcile) that must never break the main pipeline.
   */
  nonFatal?: boolean
```

- [ ] **Step 4: Implement — runner support**

In `src/agentic/agent-runner.ts`, replace the `for (const phase of opts.phases) { ... }` body (starts line 73 `checkCancelled()` … ends line 166 `emit({ type: 'phase-done', phase: phase.name })`). Wrap the whole per-phase body so it honors `shouldRun` and `nonFatal`:

```ts
        for (const phase of opts.phases) {
          checkCancelled()
          currentPhase = phase.name
          try {
            if (phase.shouldRun) {
              const ok = await phase.shouldRun({
                bookId: opts.bookId, bookRoot: opts.bookMeta.rootPath, chapterId: opts.chapterId,
                bookMeta: opts.bookMeta, chapter: opts.chapter, previousPhaseResults,
              })
              if (!ok) continue // skip — no phase-start, no model call
            }
            emit({ type: 'phase-start', phase: phase.name })
            const ctx: PhaseContext = {
              bookId: opts.bookId, bookRoot: opts.bookMeta.rootPath, chapterId: opts.chapterId,
              bookMeta: opts.bookMeta, chapter: opts.chapter, previousPhaseResults,
            }
            // ... (UNCHANGED existing body: messages, runIterations, verify, onComplete) ...
            emit({ type: 'phase-done', phase: phase.name })
          } catch (phaseErr: any) {
            if (cancelled) throw phaseErr
            if (phase.nonFatal) {
              emit({ type: 'message', phase: phase.name, role: 'assistant', content: `[非阻塞] 阶段「${phase.name}」失败已忽略：${phaseErr?.message ?? phaseErr}` })
              continue
            }
            throw phaseErr
          }
        }
```

Keep the existing inner code (the `const messages` block through the `verify`/`onComplete` blocks) verbatim inside the `try`, between `const ctx` and `emit({ type: 'phase-done' })`. Do not duplicate the `ctx` declaration.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/agentic/runner-phase-flags.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Regression — runner/phase suites still green**

Run: `npx vitest run tests/agentic`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/agentic/phases/phase.ts src/agentic/agent-runner.ts tests/agentic/runner-phase-flags.test.ts
git commit -m "feat(runner): Phase.shouldRun (skip w/o model) and Phase.nonFatal (swallow failure)"
```

---

## Task 3: `propose_volume_reconcile` 工具 + `AgentEvent` 扩展

**Files:**
- Modify: `fanqie-workbench/src/agentic/events.ts:1-13`
- Create: `fanqie-workbench/src/agentic/tools/propose-volume-reconcile.ts`
- Modify: `fanqie-workbench/src/agentic/agent-service.ts:12,52`
- Test: `fanqie-workbench/tests/agentic/tools/propose-volume-reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/agentic/tools/propose-volume-reconcile.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { proposeVolumeReconcileTool } from '../../../src/agentic/tools/propose-volume-reconcile.js'

const MARK = '## 实际完成 vs 计划偏差(对账)'
const ctx = () => ({ bookId: 'b1', bookRoot: '/x', emit: vi.fn() })

describe('propose_volume_reconcile tool', () => {
  it('emits a review-checkpoint-requested event on valid input', async () => {
    const c = ctx()
    const proposalText = `${MARK}\n- 旧钥匙未如期回收\n- 反转提前透了一半`
    const r = await proposeVolumeReconcileTool.execute({
      args: { volumeKey: '第一卷', proposalText, arcNote: '主线略提前' }, ctx: c,
    })
    expect(r.ok).toBe(true)
    expect(c.emit).toHaveBeenCalledWith({
      type: 'review-checkpoint-requested', stage: 'volume-reconcile',
      payload: { volumeKey: '第一卷', proposalText, arcNote: '主线略提前' },
    })
  })

  it('rejects proposalText missing the section marker', async () => {
    const c = ctx()
    const r = await proposeVolumeReconcileTool.execute({ args: { volumeKey: '第一卷', proposalText: '太短没有标题' }, ctx: c })
    expect(r.ok).toBe(false)
    expect(c.emit).not.toHaveBeenCalled()
  })

  it('rejects proposalText below the length floor', async () => {
    const c = ctx()
    const r = await proposeVolumeReconcileTool.execute({ args: { volumeKey: '第一卷', proposalText: MARK }, ctx: c })
    expect(r.ok).toBe(false)
  })

  it('rejects missing volumeKey', async () => {
    const c = ctx()
    const proposalText = `${MARK}\n- 一条足够长的真实偏差记录用于通过长度校验`
    const r = await proposeVolumeReconcileTool.execute({ args: { proposalText }, ctx: c })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/agentic/tools/propose-volume-reconcile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement — extend AgentEvent**

In `src/agentic/events.ts`, add a branch to the `AgentEvent` union (after the `file-updated` line):
```ts
  | { type: 'review-checkpoint-requested'; stage: 'volume-reconcile'; payload: { volumeKey: string; proposalText: string; arcNote?: string } }
```

- [ ] **Step 4: Implement — the tool**

`src/agentic/tools/propose-volume-reconcile.ts`:
```ts
import type { Tool } from './tool.js'

export const RECONCILE_MARKER = '## 实际完成 vs 计划偏差(对账)'
const MIN_PROPOSAL_CHARS = 40

export const proposeVolumeReconcileTool: Tool = {
  spec: {
    name: 'propose_volume_reconcile',
    description: `提议本卷的「计划 vs 实际偏差」对账(append-only,需用户确认)。proposalText 必须以「${RECONCILE_MARKER}」开头的小节,逐条写实质偏差。无实质偏差时不要调用本工具。`,
    parameters: {
      type: 'object',
      properties: {
        volumeKey: { type: 'string', description: '卷标识,如 第一卷' },
        proposalText: { type: 'string', description: `对账正文,含「${RECONCILE_MARKER}」小节` },
        arcNote: { type: 'string', description: '可选;仅当偏差波及全书主线时,给总纲的一句话' },
      },
      required: ['volumeKey', 'proposalText'],
    },
  },
  async execute({ args, ctx }) {
    const volumeKey = typeof args.volumeKey === 'string' ? args.volumeKey.trim() : ''
    const proposalText = typeof args.proposalText === 'string' ? args.proposalText : ''
    const arcNote = typeof args.arcNote === 'string' && args.arcNote.trim() ? args.arcNote.trim() : undefined
    if (!volumeKey) return { ok: false, error: 'volumeKey is required' }
    if (!proposalText.includes(RECONCILE_MARKER)) {
      return { ok: false, error: `proposalText must contain the section marker: ${RECONCILE_MARKER}` }
    }
    if (proposalText.trim().length < MIN_PROPOSAL_CHARS) {
      return { ok: false, error: `proposalText too short (< ${MIN_PROPOSAL_CHARS} chars)` }
    }
    ctx.emit({
      type: 'review-checkpoint-requested',
      stage: 'volume-reconcile',
      payload: { volumeKey, proposalText, ...(arcNote ? { arcNote } : {}) },
    })
    return { ok: true, result: `proposed reconciliation for ${volumeKey}` }
  },
}
```

- [ ] **Step 5: Implement — register the tool**

In `src/agentic/agent-service.ts`:
- Add import after line 12:
```ts
import { proposeVolumeReconcileTool } from './tools/propose-volume-reconcile.js'
```
- Add registration after line 52 (`tools.register(updateTrackingTool)`):
```ts
  tools.register(proposeVolumeReconcileTool)
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/agentic/tools/propose-volume-reconcile.test.ts`
Expected: PASS (4/4).

- [ ] **Step 7: Commit**

```bash
git add src/agentic/events.ts src/agentic/tools/propose-volume-reconcile.ts src/agentic/agent-service.ts tests/agentic/tools/propose-volume-reconcile.test.ts
git commit -m "feat(tool): propose_volume_reconcile (emit-only) + AgentEvent branch"
```

---

## Task 4: `review_checkpoints` 持久层(payload_json + 类型 + 去重查询)

**Files:**
- Modify: `fanqie-workbench/src/db/schema.ts:107-123`
- Modify: `fanqie-workbench/src/db/client.ts:5-12`
- Modify: `fanqie-workbench/src/db/repositories/review-checkpoints-repo.ts`(全文多处)
- Test: `fanqie-workbench/tests/db/review-checkpoints-payload.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/db/review-checkpoints-payload.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import {
  createReviewCheckpoint, getReviewCheckpointById, getActiveVolumeReconcile,
} from '../../src/db/repositories/review-checkpoints-repo'

async function tmpDbPath() {
  const dir = await mkdtemp(resolve(tmpdir(), 'wb-rcp-'))
  return resolve(dir, 'workbench.sqlite')
}

function seedBookSession(db: Database.Database) {
  const now = new Date().toISOString()
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?,?,?)').run('bk', 'T', '/tmp/bk')
  db.prepare('INSERT INTO sessions (id, kind, book_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run('se', 'agent', 'bk', 'running', now, now)
}

describe('review_checkpoints payload + dedup', () => {
  it('migrates payload_json onto a legacy table', async () => {
    const path = await tmpDbPath()
    const legacy = new Database(path)
    legacy.exec(`CREATE TABLE review_checkpoints (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, book_id TEXT NOT NULL, chapter_id TEXT,
      stage TEXT NOT NULL, title TEXT NOT NULL, summary_json TEXT NOT NULL,
      changed_files_json TEXT NOT NULL, options_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, resolved_at TEXT)`)
    legacy.close()
    const db = openDatabase(path)
    const cols = (db.prepare('PRAGMA table_info(review_checkpoints)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols).toContain('payload_json')
    db.close()
  })

  it('round-trips payload and finds active volume-reconcile by (bookId, volumeKey)', async () => {
    const db = openDatabase(await tmpDbPath())
    seedBookSession(db)
    const cp = createReviewCheckpoint(db, {
      sessionId: 'se', bookId: 'bk', chapterId: null, stage: 'volume-reconcile',
      title: '第一卷对账', summary: { completed: [], checks: [] },
      changedFiles: [], options: ['apply', 'apply-edited', 'skip'],
      payload: { volumeKey: '第一卷', proposalText: '## x\n- y' },
    })
    const got = getReviewCheckpointById(db, cp.id)
    expect(got?.payload).toEqual({ volumeKey: '第一卷', proposalText: '## x\n- y' })
    expect(getActiveVolumeReconcile(db, 'bk', '第一卷')?.id).toBe(cp.id)
    expect(getActiveVolumeReconcile(db, 'bk', '第二卷')).toBeNull()
    db.close()
  })

  it('legacy/chapter-complete rows (no payload) read back as null without throwing', async () => {
    const db = openDatabase(await tmpDbPath())
    seedBookSession(db)
    const cp = createReviewCheckpoint(db, {
      sessionId: 'se', bookId: 'bk', chapterId: null, stage: 'chapter-complete',
      title: 't', summary: { completed: [], checks: [] }, changedFiles: [], options: ['accept'],
    })
    expect(getReviewCheckpointById(db, cp.id)?.payload).toBeNull()
    db.close()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/db/review-checkpoints-payload.test.ts`
Expected: FAIL — `getActiveVolumeReconcile` not exported / `payload` missing / column absent.

- [ ] **Step 3: Implement — schema + migration**

In `src/db/schema.ts`, inside `CREATE TABLE IF NOT EXISTS review_checkpoints (...)`, add a column after `resolved_at TEXT,` line (before the FOREIGN KEYs):
```sql
  payload_json TEXT,
```

In `src/db/client.ts`, add to the `additiveMigrations` array (after the last entry, before `] as const`):
```ts
  { table: 'review_checkpoints', column: 'payload_json', sql: 'ALTER TABLE review_checkpoints ADD COLUMN payload_json TEXT' },
```
(No change needed to `existingTablesBeforeSchema` — it already includes `review_checkpoints` at client.ts:130.)

- [ ] **Step 4: Implement — repo types + map + parse + create + dedup**

In `src/db/repositories/review-checkpoints-repo.ts`:

(a) Widen the stage/option types (lines 4-6):
```ts
export type ReviewCheckpointStage = 'chapter-complete' | 'volume-reconcile'
export type ReviewCheckpointStatus = 'pending' | 'accepted' | 'resolved-action' | 'dismissed' | 'superseded'
export type ReviewCheckpointOption =
  | 'accept' | 'deslop' | 'rewrite' | 'continue-next' | 'save-only'
  | 'apply' | 'apply-edited' | 'skip'
```

(b) Add a payload type + extend record/row types:
```ts
export type VolumeReconcilePayload = { volumeKey: string; proposalText: string; arcNote?: string }
```
Add `payload: VolumeReconcilePayload | null` to `ReviewCheckpointRecord` (after `options`).
Add `payload_json: string | null` to `ReviewCheckpointRow` (after `options_json`).

(c) Add a tolerant parser + harden existing parsers:
```ts
function parsePayload(value: string | null): VolumeReconcilePayload | null {
  if (!value || value === 'undefined') return null
  try {
    const p = JSON.parse(value) as Partial<VolumeReconcilePayload>
    if (!p || typeof p.volumeKey !== 'string' || typeof p.proposalText !== 'string') return null
    return { volumeKey: p.volumeKey, proposalText: p.proposalText, ...(typeof p.arcNote === 'string' ? { arcNote: p.arcNote } : {}) }
  } catch { return null }
}
```
Wrap the bodies of `parseJsonArray` and `parseSummary` in try/catch returning `[]` / `{completed:[],checks:[]}` on parse error.

(d) `mapReviewCheckpointRow`: add `payload: parsePayload(row.payload_json),`.

(e) `createReviewCheckpoint` input: add optional `payload?: VolumeReconcilePayload`. INSERT must include the column. Change the INSERT to:
```ts
  db.prepare(
    `INSERT INTO review_checkpoints (
      id, session_id, book_id, chapter_id, stage, title,
      summary_json, changed_files_json, options_json, status, created_at, resolved_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?)`,
  ).run(
    id, input.sessionId, input.bookId, input.chapterId ?? null, input.stage, input.title,
    JSON.stringify(input.summary), JSON.stringify(input.changedFiles), JSON.stringify(input.options),
    now, input.payload ? JSON.stringify(input.payload) : null,
  )
```
And the returned object literal gains `payload: input.payload ?? null,`.

(f) Both SELECT column lists (`getReviewCheckpointById`, `getPendingReviewCheckpointBySessionId`) must add `payload_json` to the selected columns.

(g) Add the dedup query:
```ts
export function getActiveVolumeReconcile(db: Database.Database, bookId: string, volumeKey: string): ReviewCheckpointRecord | null {
  const rows = db.prepare(
    `SELECT id, session_id, book_id, chapter_id, stage, title, summary_json,
            changed_files_json, options_json, status, created_at, resolved_at, payload_json
     FROM review_checkpoints
     WHERE book_id = ? AND stage = 'volume-reconcile' AND status != 'dismissed'`,
  ).all(bookId) as ReviewCheckpointRow[]
  const match = rows.map(mapReviewCheckpointRow).find((r) => r.payload?.volumeKey === volumeKey)
  return match ?? null
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/db/review-checkpoints-payload.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Regression**

Run: `npx vitest run tests/db tests/server/books-route.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/client.ts src/db/repositories/review-checkpoints-repo.ts tests/db/review-checkpoints-payload.test.ts
git commit -m "feat(db): review_checkpoints payload_json + volume-reconcile stage/options + dedup query"
```

---

## Task 5: `createVolumeReconcileCheckpoint` service

**Files:**
- Modify: `fanqie-workbench/src/server/review-checkpoint-service.ts`
- Test: `fanqie-workbench/tests/server/volume-reconcile-checkpoint.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/volume-reconcile-checkpoint.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { createVolumeReconcileCheckpoint } from '../../src/server/review-checkpoint-service'
import { getReviewCheckpointById } from '../../src/db/repositories/review-checkpoints-repo'

async function db() {
  const dir = await mkdtemp(resolve(tmpdir(), 'wb-vrc-'))
  const d = openDatabase(resolve(dir, 'wb.sqlite'))
  const now = new Date().toISOString()
  d.prepare('INSERT INTO books (id, title, root_path) VALUES (?,?,?)').run('bk', 'T', '/tmp/bk')
  d.prepare('INSERT INTO sessions (id, kind, book_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').run('se', 'agent', 'bk', 'running', now, now)
  return d
}

describe('createVolumeReconcileCheckpoint', () => {
  it('creates a pending volume-reconcile checkpoint carrying the payload + apply options', async () => {
    const d = await db()
    const cp = createVolumeReconcileCheckpoint(d, {
      sessionId: 'se', bookId: 'bk',
      payload: { volumeKey: '第一卷', proposalText: '## 实际完成 vs 计划偏差(对账)\n- 偏差一二三' },
    })
    const got = getReviewCheckpointById(d, cp.id)
    expect(got?.stage).toBe('volume-reconcile')
    expect(got?.status).toBe('pending')
    expect(got?.options).toEqual(['apply', 'apply-edited', 'skip'])
    expect(got?.payload?.volumeKey).toBe('第一卷')
    expect(got?.title).toContain('第一卷')
    d.close()
  })

  it('is a no-op (returns existing) when an active checkpoint for the same volume exists', async () => {
    const d = await db()
    const payload = { volumeKey: '第一卷', proposalText: '## 实际完成 vs 计划偏差(对账)\n- x 偏差内容够长' }
    const first = createVolumeReconcileCheckpoint(d, { sessionId: 'se', bookId: 'bk', payload })
    const second = createVolumeReconcileCheckpoint(d, { sessionId: 'se', bookId: 'bk', payload })
    expect(second.id).toBe(first.id)
    d.close()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/volume-reconcile-checkpoint.test.ts`
Expected: FAIL — `createVolumeReconcileCheckpoint` not exported.

- [ ] **Step 3: Implement**

Append to `src/server/review-checkpoint-service.ts`:
```ts
import {
  createReviewCheckpoint, getActiveVolumeReconcile, type VolumeReconcilePayload,
} from '../db/repositories/review-checkpoints-repo.js'

export function createVolumeReconcileCheckpoint(db: Database.Database, input: {
  sessionId: string
  bookId: string
  payload: VolumeReconcilePayload
}) {
  const existing = getActiveVolumeReconcile(db, input.bookId, input.payload.volumeKey)
  if (existing) return existing // DB-side dedup: one active reconcile per (book, volume)
  return createReviewCheckpoint(db, {
    sessionId: input.sessionId,
    bookId: input.bookId,
    chapterId: null,
    stage: 'volume-reconcile',
    title: `${input.payload.volumeKey}对账:计划 vs 实际`,
    summary: { completed: ['已对照卷纲计划与各章实际,检出偏差'], checks: ['确认偏差描述,可编辑后追加进卷纲'] },
    changedFiles: [],
    options: ['apply', 'apply-edited', 'skip'],
    payload: input.payload,
  })
}
```
(The `import type Database` already exists at the top of the file; reuse it. Add the new repo import alongside the existing `createReviewCheckpoint` import — merge into one import statement if you prefer.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/server/volume-reconcile-checkpoint.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/server/review-checkpoint-service.ts tests/server/volume-reconcile-checkpoint.test.ts
git commit -m "feat(service): createVolumeReconcileCheckpoint with (book,volume) dedup"
```

---

## Task 6: `volume-reconcile` phase + 接入 action-router

**Files:**
- Create: `fanqie-workbench/src/agentic/phases/volume-reconcile.ts`
- Modify: `fanqie-workbench/src/agentic/action-router.ts:1-22`
- Test: `fanqie-workbench/tests/agentic/phases/volume-reconcile.test.ts`
- Test: `fanqie-workbench/tests/agentic/action-router.test.ts`(扩展)

- [ ] **Step 1: Write the failing test (phase)**

`tests/agentic/phases/volume-reconcile.test.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { volumeReconcilePhase } from '../../../src/agentic/phases/volume-reconcile.js'

function bookRoot(volEnd: number) {
  const root = mkdtempSync(join(tmpdir(), 'vr-'))
  mkdirSync(join(root, '大纲'), { recursive: true })
  writeFileSync(join(root, '大纲', '卷纲_第一卷.md'), `# 第一卷\n章节范围:第1-${volEnd}章\n## 本卷目标\n…`)
  return root
}
const ctx = (root: string, chapterNumber: number) => ({
  bookId: 'b1', bookRoot: root, chapterId: 'c1',
  bookMeta: { id: 'b1', title: 'T', rootPath: root } as any,
  chapter: { id: 'c1', chapterNumber, title: 't', sourcePath: '正文/x.md', stage: '已初稿' } as any,
  previousPhaseResults: {},
})

describe('volume-reconcile phase', () => {
  it('is non-fatal and uses read/list + propose tool, never ask_user', () => {
    expect(volumeReconcilePhase.nonFatal).toBe(true)
    expect(volumeReconcilePhase.tools).toEqual(expect.arrayContaining(['read_file', 'list_dir', 'propose_volume_reconcile']))
    expect(volumeReconcilePhase.tools).not.toContain('ask_user')
  })

  it('shouldRun=true only when the chapter is a volume-end', async () => {
    const root = bookRoot(8)
    expect(await volumeReconcilePhase.shouldRun!(ctx(root, 8) as any)).toBe(true)
    expect(await volumeReconcilePhase.shouldRun!(ctx(root, 5) as any)).toBe(false)
  })

  it('shouldRun=false (graceful) when 大纲 dir missing — never throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vr-empty-'))
    await expect(volumeReconcilePhase.shouldRun!(ctx(root, 8) as any)).resolves.toBe(false)
  })

  it('prompt names the target volume and the required section marker', () => {
    const root = bookRoot(8)
    const p = volumeReconcilePhase.systemPrompt(ctx(root, 8) as any)
    expect(p).toContain('第一卷')
    expect(p).toContain('实际完成 vs 计划偏差')
    expect(p).toMatch(/无.*偏差|按计划/) // instruct: no divergence → don't call the tool
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/agentic/phases/volume-reconcile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the phase**

`src/agentic/phases/volume-reconcile.ts`:
```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Phase, PhaseContext } from './phase.js'
import { parseVolumeFileName, parseVolumeChapterRange, findVolumeEndingAt, type VolumeRange } from '../../domain/volume.js'
import { RECONCILE_MARKER } from '../tools/propose-volume-reconcile.js'

/** Read 大纲/, return every 卷纲_第X卷.md with a parseable 章节范围. Never throws. */
function readVolumeRanges(bookRoot: string): VolumeRange[] {
  try {
    const dir = join(bookRoot, '大纲')
    const out: VolumeRange[] = []
    for (const name of readdirSync(dir)) {
      const volumeNumber = parseVolumeFileName(name)
      if (volumeNumber == null) continue
      const range = parseVolumeChapterRange(readFileSync(join(dir, name), 'utf8'))
      if (range) out.push({ volumeNumber, start: range.start, end: range.end })
    }
    return out
  } catch { return [] }
}

function endingVolume(ctx: PhaseContext): { volumeNumber: number } | null {
  const n = ctx.chapter?.chapterNumber
  if (!n) return null
  return findVolumeEndingAt(n, readVolumeRanges(ctx.bookRoot))
}

export const volumeReconcilePhase: Phase = {
  name: 'volume-reconcile',
  tools: ['read_file', 'list_dir', 'grep', 'propose_volume_reconcile'],
  maxIterations: 6,
  nonFatal: true,
  async shouldRun(ctx) {
    try { return endingVolume(ctx) != null } catch { return false }
  },
  systemPrompt(ctx) {
    const vol = endingVolume(ctx)
    const volLabel = vol ? `第${vol.volumeNumber}卷` : '本卷'
    return [
      `《${ctx.bookMeta.title}》刚写完第${ctx.chapter?.chapterNumber}章,这是【${volLabel}】的末章。对该卷做一次「计划 vs 实际」对账。`,
      `bookRoot = ${ctx.bookRoot}`,
      ``,
      `步骤:`,
      `1. 读 大纲/卷纲_第${vol?.volumeNumber ?? ''}卷.md 的计划(爽点节奏/伏笔布局/关键反转/情绪弧线/人物弧线/卷末钩子/核心矛盾)。`,
      `2. 读本卷各章的细纲「实际完成情况」(大纲/细纲_第*章.md)+ 追踪/伏笔.md + 追踪/角色状态.md,掌握实际。`,
      `3. 逐维度对照,只挑【实质偏差】:伏笔未如期回收 / 反转提前或推迟 / 卷末钩子是否兑现 / 核心矛盾是否真收束 / 情绪与爽点节奏是否走样。`,
      `4. 若【无实质偏差】(基本按计划完成)——直接说明,【不要调用任何工具】,结束。`,
      `5. 若有偏差——调用 propose_volume_reconcile,proposalText 以「${RECONCILE_MARKER}」开头、逐条列偏差;只有当偏差波及全书主线时才填 arcNote。`,
      `不写任何文件;不要问用户。`,
    ].join('\n')
  },
  initialUserMessage(ctx) {
    return `请对【第${endingVolume(ctx)?.volumeNumber ?? ''}卷】做计划 vs 实际对账;无实质偏差则不调用工具。`
  },
}
```

- [ ] **Step 4: Run to verify pass (phase)**

Run: `npx vitest run tests/agentic/phases/volume-reconcile.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Wire into action-router + extend its test**

In `src/agentic/action-router.ts`:
- Add import after line 11:
```ts
import { volumeReconcilePhase } from './phases/volume-reconcile.js'
```
- Append `volumeReconcilePhase` to the end of the `chapter.continue` and `chapter.next` arrays:
```ts
  'chapter.continue': [loadContextPhase, checkMaterialsPhase, writeChapterPhase, updateTrackingPhase, volumeReconcilePhase],
  'chapter.next': [loadContextPhase, writeOutlinePhase, writeChapterPhase, polishChapterPhase, updateTrackingPhase, volumeReconcilePhase],
```

In `tests/agentic/action-router.test.ts`, update the two affected assertions:
- `chapter.continue` expected array → append `'volume-reconcile'`.
- `chapter.next` expected array → append `'volume-reconcile'`.

- [ ] **Step 6: Run to verify pass (router)**

Run: `npx vitest run tests/agentic/action-router.test.ts tests/agentic/phases/volume-reconcile.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agentic/phases/volume-reconcile.ts src/agentic/action-router.ts tests/agentic/phases/volume-reconcile.test.ts tests/agentic/action-router.test.ts
git commit -m "feat(phase): volume-reconcile (deterministic gate + divergence-only) wired into chapter pipelines"
```

---

## Task 7: run 启动补建 sessions 行 + `wireReviewCheckpointRequest`

**Files:**
- Modify: `fanqie-workbench/src/server/routes/agent-sessions.ts`(导入、helper、两个写作 handler)
- Test: `fanqie-workbench/tests/server/agent-sessions-volume-reconcile.test.ts`

**背景:** `review_checkpoints.session_id` 是 NOT NULL + FK→sessions,但 agent run 不建 sessions 行。两处写作 handler(`/api/agent-sessions` 通用、`/api/agent-sessions/chapter-next`)在生成 `sessionId` 后补建 `kind='agent'` 的 sessions 行;并仿 `wireStageAdvance` 挂监听把工具发的 `review-checkpoint-requested` 事件落成 checkpoint。

- [ ] **Step 1: Write the failing test**

`tests/server/agent-sessions-volume-reconcile.test.ts`:
```ts
import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { ensureAgentSessionRow, wireReviewCheckpointRequest } from '../../src/server/routes/agent-sessions'
import { getReviewCheckpointById, getActiveVolumeReconcile } from '../../src/db/repositories/review-checkpoints-repo'

async function db() {
  const dir = await mkdtemp(resolve(tmpdir(), 'wb-asvr-'))
  const d = openDatabase(resolve(dir, 'wb.sqlite'))
  d.prepare('INSERT INTO books (id, title, root_path) VALUES (?,?,?)').run('bk', 'T', '/tmp/bk')
  return d
}

describe('agent-sessions volume-reconcile wiring', () => {
  it('ensureAgentSessionRow inserts a kind=agent session satisfying the FK', async () => {
    const d = await db()
    ensureAgentSessionRow(d, { sessionId: 'se', bookId: 'bk', chapterId: null })
    const row = d.prepare('SELECT kind FROM sessions WHERE id = ?').get('se') as { kind: string } | undefined
    expect(row?.kind).toBe('agent')
    d.close()
  })

  it('wireReviewCheckpointRequest turns the event into a volume-reconcile checkpoint', async () => {
    const d = await db()
    ensureAgentSessionRow(d, { sessionId: 'se', bookId: 'bk', chapterId: null })
    const emitter = new EventEmitter()
    wireReviewCheckpointRequest(d, emitter, { sessionId: 'se', bookId: 'bk' })
    emitter.emit('event', {
      type: 'review-checkpoint-requested', stage: 'volume-reconcile',
      payload: { volumeKey: '第一卷', proposalText: '## 实际完成 vs 计划偏差(对账)\n- 一条够长的偏差' },
    })
    const cp = getActiveVolumeReconcile(d, 'bk', '第一卷')
    expect(cp).not.toBeNull()
    expect(getReviewCheckpointById(d, cp!.id)?.stage).toBe('volume-reconcile')
    d.close()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/agent-sessions-volume-reconcile.test.ts`
Expected: FAIL — `ensureAgentSessionRow` / `wireReviewCheckpointRequest` not exported.

- [ ] **Step 3: Implement — exported helpers**

In `src/server/routes/agent-sessions.ts`:
- Add imports near the top (after the existing repo import added in B1):
```ts
import { randomUUID } from 'node:crypto' // already imported — do not duplicate
import { createVolumeReconcileCheckpoint } from '../review-checkpoint-service.js'
```
- Add two exported module-level helpers (above `registerAgentSessionsRoutes`):
```ts
/** Agent runs don't create a sessions row, but review_checkpoints.session_id FK needs one. */
export function ensureAgentSessionRow(
  db: Database.Database,
  input: { sessionId: string; bookId: string; chapterId: string | null },
) {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, kind, book_id, chapter_id, status, created_at, updated_at)
     VALUES (?, 'agent', ?, ?, 'running', ?, ?)`,
  ).run(input.sessionId, input.bookId, input.chapterId, now, now)
}

/** Mirror of wireStageAdvance: turn a tool-emitted reconcile event into a checkpoint. */
export function wireReviewCheckpointRequest(
  db: Database.Database,
  emitter: EventEmitter,
  input: { sessionId: string; bookId: string },
) {
  emitter.on('event', (ev: any) => {
    if (ev?.type !== 'review-checkpoint-requested' || ev.stage !== 'volume-reconcile') return
    try {
      createVolumeReconcileCheckpoint(db, { sessionId: input.sessionId, bookId: input.bookId, payload: ev.payload })
    } catch (err) {
      console.error('[volume-reconcile] failed to create checkpoint', err)
    }
  })
}
```

- [ ] **Step 4: Implement — call them in both writing handlers**

In the **generic `/api/agent-sessions` handler**, right after `activeBookIds.add(bookId)` and before `wireStageAdvance(...)`:
```ts
      ensureAgentSessionRow(deps.db, { sessionId, bookId, chapterId })
      wireReviewCheckpointRequest(deps.db, emitter, { sessionId, bookId })
```

In the **`/api/agent-sessions/chapter-next` handler**, right after `activeBookIds.add(bookId)` and before `wireStageAdvance(emitter, chapterId, 'chapter.next')`:
```ts
      ensureAgentSessionRow(deps.db, { sessionId, bookId, chapterId })
      wireReviewCheckpointRequest(deps.db, emitter, { sessionId, bookId })
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/server/agent-sessions-volume-reconcile.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: Regression**

Run: `npx vitest run tests/server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/agent-sessions.ts tests/server/agent-sessions-volume-reconcile.test.ts
git commit -m "feat(routes): backfill agent session row + wire review-checkpoint-requested → checkpoint"
```

---

## Task 8: resolve 路由 — stage 分支 + editedText + 落盘 + 幂等 + 越权防护

**Files:**
- Modify: `fanqie-workbench/src/server/routes/review-checkpoints.ts`
- Test: `fanqie-workbench/tests/server/review-checkpoints-resolve-volume.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/review-checkpoints-resolve-volume.test.ts`:
```ts
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { registerReviewCheckpointRoutes } from '../../src/server/routes/review-checkpoints'
import { createVolumeReconcileCheckpoint } from '../../src/server/review-checkpoint-service'

const MARK = '## 实际完成 vs 计划偏差(对账)'

async function setup() {
  const dir = await mkdtemp(resolve(tmpdir(), 'wb-rrv-'))
  const bookRoot = resolve(dir, 'book')
  await mkdir(resolve(bookRoot, '大纲'), { recursive: true })
  await writeFile(resolve(bookRoot, '大纲', '卷纲_第一卷.md'), '# 第一卷\n章节范围:第1-8章\n## 本卷目标\n原文', 'utf8')
  const dbPath = resolve(dir, 'wb.sqlite')
  process.env.WORKBENCH_DB = dbPath
  const db = openDatabase(dbPath)
  const now = new Date().toISOString()
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?,?,?)').run('bk', 'T', bookRoot)
  db.prepare('INSERT INTO sessions (id, kind, book_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').run('se', 'agent', 'bk', 'running', now, now)
  const app = Fastify()
  await registerReviewCheckpointRoutes(app)
  return { app, db, bookRoot, volumePath: resolve(bookRoot, '大纲', '卷纲_第一卷.md') }
}
function mkCheckpoint(db: any, proposalText = `${MARK}\n- 旧钥匙未如期回收`) {
  return createVolumeReconcileCheckpoint(db, { sessionId: 'se', bookId: 'bk', payload: { volumeKey: '第一卷', proposalText } })
}

describe('resolve volume-reconcile', () => {
  it('apply appends proposalText (with anchor) to the volume file', async () => {
    const { app, db, volumePath } = await setup()
    const cp = mkCheckpoint(db)
    const res = await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'apply' } })
    expect(res.statusCode).toBe(200)
    const text = await readFile(volumePath, 'utf8')
    expect(text).toContain('原文') // original preserved
    expect(text).toContain(MARK)
    expect(text).toContain('旧钥匙未如期回收')
    expect(text).toContain('<!-- volume-reconcile:第一卷 -->')
  })

  it('apply-edited appends the edited text instead', async () => {
    const { app, db, volumePath } = await setup()
    const cp = mkCheckpoint(db)
    const editedText = `${MARK}\n- 我手改过的偏差`
    await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'apply-edited', editedText } })
    expect(await readFile(volumePath, 'utf8')).toContain('我手改过的偏差')
  })

  it('skip writes nothing and dismisses', async () => {
    const { app, db, volumePath } = await setup()
    const before = await readFile(volumePath, 'utf8')
    const cp = mkCheckpoint(db)
    await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'skip' } })
    expect(await readFile(volumePath, 'utf8')).toBe(before)
  })

  it('double apply appends only once', async () => {
    const { app, db, volumePath } = await setup()
    const cp = mkCheckpoint(db)
    await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'apply' } })
    const r2 = await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'apply' } })
    expect(r2.statusCode).toBe(409)
    const occurrences = (await readFile(volumePath, 'utf8')).split('<!-- volume-reconcile:第一卷 -->').length - 1
    expect(occurrences).toBe(1)
  })

  it('chapter-complete still rejects unknown volume actions (per-stage allowlist)', async () => {
    const { app, db } = await setup()
    // a chapter-complete checkpoint cannot use 'apply'
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES ('ch','bk',1,'第1章','/tmp/book/正文/第001章.md','已初稿')`).run()
    const { createReviewCheckpoint } = await import('../../src/db/repositories/review-checkpoints-repo')
    const cc = createReviewCheckpoint(db, { sessionId: 'se', bookId: 'bk', chapterId: 'ch', stage: 'chapter-complete', title: 't', summary: { completed: [], checks: [] }, changedFiles: [], options: ['accept'] })
    const res = await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cc.id}/resolve`, payload: { action: 'apply' } })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/review-checkpoints-resolve-volume.test.ts`
Expected: FAIL — `apply`/`apply-edited`/`skip` rejected (400) by the current whitelist; no append happens.

- [ ] **Step 3: Implement — restructure resolve by stage**

In `src/server/routes/review-checkpoints.ts`:

(a) Add imports:
```ts
import { resolve as resolvePath, join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
```

(b) Replace the `supportedActions` constant with per-stage allowlists + an exhaustiveness helper:
```ts
const CHAPTER_COMPLETE_ACTIONS: ReviewCheckpointOption[] = ['accept', 'deslop', 'rewrite', 'continue-next', 'save-only']
const VOLUME_RECONCILE_ACTIONS: ReviewCheckpointOption[] = ['apply', 'apply-edited', 'skip']
```

(c) Widen the Body type:
```ts
    Body: { action?: ReviewCheckpointOption; comment?: string; editedText?: string }
```

(d) After loading + null/pending checks (keep `getReviewCheckpointById`, `checkpoint.status !== 'pending'` → 409), **branch by stage before the chapterId guard**:
```ts
      if (checkpoint.stage === 'volume-reconcile') {
        return await resolveVolumeReconcile(db, reply, checkpoint, action, request.body || {})
      }
      // chapter-complete path (existing behaviour):
      if (!CHAPTER_COMPLETE_ACTIONS.includes(action)) return reply.code(400).send({ error: 'unsupported review action' })
      if (!checkpoint.chapterId) return reply.code(400).send({ error: 'checkpoint has no chapter' })
      // ... existing accept/save-only/continue-next/deslop|rewrite logic unchanged ...
```
(Move the original `supportedActions` line-35 check into the chapter-complete branch as shown; delete the top-level one.)

(e) Add the volume-reconcile handler with transactional idempotency + path containment:
```ts
async function resolveVolumeReconcile(
  db: ReturnType<typeof openDatabase>,
  reply: any,
  checkpoint: NonNullable<ReturnType<typeof getReviewCheckpointById>>,
  action: ReviewCheckpointOption,
  body: { editedText?: string },
) {
  if (!VOLUME_RECONCILE_ACTIONS.includes(action)) return reply.code(400).send({ error: 'unsupported review action' })
  if (action === 'skip') {
    const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'dismissed')
    return { checkpoint: resolved }
  }
  const payload = checkpoint.payload
  if (!payload) return reply.code(400).send({ error: 'checkpoint has no payload' })
  const text = action === 'apply-edited' ? (body.editedText ?? '') : payload.proposalText
  if (!text.trim()) return reply.code(400).send({ error: 'editedText is required for apply-edited' })

  // Resolve the target path from the trusted book root — never from payload.
  const book = db.prepare('SELECT root_path FROM books WHERE id = ?').get(checkpoint.bookId) as { root_path: string } | undefined
  if (!book) return reply.code(404).send({ error: 'book not found' })
  const volumeNumberLabel = payload.volumeKey.replace(/^第/, '').replace(/卷$/, '')
  const target = resolvePath(book.root_path, '大纲', `卷纲_第${volumeNumberLabel}卷.md`)
  const allowedRoot = resolvePath(book.root_path, '大纲')
  if (!target.startsWith(allowedRoot + '/') && target !== join(allowedRoot, `卷纲_第${volumeNumberLabel}卷.md`)) {
    return reply.code(400).send({ error: 'target path escapes book outline dir' })
  }

  // Transactional claim: only the first resolver flips pending→accepted and writes.
  const claim = db.prepare("UPDATE review_checkpoints SET status='accepted', resolved_at=? WHERE id=? AND status='pending'")
  const claimed = db.transaction((id: string) => claim.run(new Date().toISOString(), id).changes)(checkpoint.id)
  if (claimed === 0) return reply.code(409).send({ error: 'checkpoint already resolved' })

  const anchor = `<!-- volume-reconcile:${payload.volumeKey} -->`
  const existing = await readFile(target, 'utf8').catch(() => '')
  const block = text.includes(anchor) ? text : text.replace(/\n/, `\n${anchor}\n`)
  await writeFile(target, `${existing.replace(/\s*$/, '')}\n\n${block}\n`, 'utf8')

  if (payload.arcNote) {
    const arcCandidates = ['总纲.md', '大纲.md'].map((n) => resolvePath(book.root_path, '大纲', n))
    for (const ap of arcCandidates) {
      const cur = await readFile(ap, 'utf8').catch(() => null)
      if (cur == null) continue
      await writeFile(ap, `${cur.replace(/\s*$/, '')}\n\n## 对账记录\n${anchor}\n- ${payload.arcNote}\n`, 'utf8')
      break
    }
  }
  return { checkpoint: getReviewCheckpointById(db, checkpoint.id) }
}
```
Note: the anchor injection `text.replace(/\n/, ...)` inserts the anchor right after the first line (the `## …(对账)` heading). If `text` already contains the anchor, it is used as-is. `apply` reuses `payload.proposalText` which the model produced without an anchor → anchor injected here.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/server/review-checkpoints-resolve-volume.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Regression — existing chapter-complete resolve tests**

Run: `npx vitest run tests/server`
Expected: PASS (chapter-complete path unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/review-checkpoints.ts tests/server/review-checkpoints-resolve-volume.test.ts
git commit -m "feat(routes): resolve volume-reconcile (append-only, idempotent, path-contained)"
```

---

## Task 9: 前端卡片 — stage 分支 UI + editedText

**Files:**
- Modify: `fanqie-workbench/src/web/components/review-checkpoint-card.tsx`
- Test: `fanqie-workbench/tests/web/review-checkpoint-card-volume.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/web/review-checkpoint-card-volume.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cp = {
  id: 'cp1', stage: 'volume-reconcile', title: '第一卷对账',
  summary: { completed: [], checks: [] }, changedFiles: [],
  options: ['apply', 'apply-edited', 'skip'], status: 'pending',
  payload: { volumeKey: '第一卷', proposalText: '## 实际完成 vs 计划偏差(对账)\n- 旧钥匙未回收' },
}

afterEach(() => vi.restoreAllMocks())

describe('ReviewCheckpointCard volume-reconcile', () => {
  it('shows the proposal in an editable textarea and submits editedText on 编辑后应用', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkpoint: cp }) }) // GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checkpoint: { ...cp, status: 'accepted' } }) }) // POST
    vi.stubGlobal('fetch', fetchMock)
    const { ReviewCheckpointCard } = await import('../../src/web/components/review-checkpoint-card')
    render(<ReviewCheckpointCard sessionId="se" sessionStatus="succeeded" />)

    const textarea = await screen.findByDisplayValue(/旧钥匙未回收/)
    fireEvent.change(textarea, { target: { value: '## 实际完成 vs 计划偏差(对账)\n- 我改过' } })
    fireEvent.click(screen.getByText('编辑后应用'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')
      expect(post).toBeTruthy()
      const sent = JSON.parse(post![1].body)
      expect(sent.action).toBe('apply-edited')
      expect(sent.editedText).toContain('我改过')
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/web/review-checkpoint-card-volume.test.tsx`
Expected: FAIL — no editable proposal textarea / `apply-edited` label / editedText not sent.

- [ ] **Step 3: Implement**

In `src/web/components/review-checkpoint-card.tsx`:

(a) Replace the local `ReviewAction` type (line 4) with the full set, and extend the `ReviewCheckpoint` type to carry `stage` + `payload`:
```ts
type ReviewAction = 'accept' | 'deslop' | 'rewrite' | 'continue-next' | 'save-only' | 'apply' | 'apply-edited' | 'skip'

type ReviewCheckpoint = {
  id: string
  stage?: string
  title: string
  summary: { completed: string[]; checks: string[] }
  changedFiles: string[]
  options: ReviewAction[]
  status: string
  payload?: { volumeKey: string; proposalText: string; arcNote?: string } | null
}
```

(b) Extend `actionLabels`:
```ts
const actionLabels: Record<ReviewAction, string> = {
  accept: '接受', deslop: '去 AI 味', rewrite: '回炉重写',
  'continue-next': '继续下一章', 'save-only': '只保存，不继续',
  apply: '应用追加', 'apply-edited': '编辑后应用', skip: '跳过',
}
```

(c) Add an `editedText` state next to `comment`:
```ts
  const [editedText, setEditedText] = useState('')
```
And seed it when a volume-reconcile checkpoint loads — in the `.then(...)` after `setCheckpoint(body.checkpoint ?? null)`:
```ts
        if (!cancelled && body.checkpoint?.stage === 'volume-reconcile') {
          setEditedText(body.checkpoint.payload?.proposalText ?? '')
        }
```

(d) In `resolve(action)`, send `editedText` for the volume stage:
```ts
        body: JSON.stringify(
          checkpoint?.stage === 'volume-reconcile'
            ? { action, editedText }
            : { action, comment },
        ),
```

(e) Render branch: when `checkpoint.stage === 'volume-reconcile'`, render the editable proposal textarea (bound to `editedText`) instead of the comment box; keep the buttons block (it already maps `checkpoint.options`). Replace the existing `<textarea …value={comment}…/>` with:
```tsx
          {checkpoint.stage === 'volume-reconcile' ? (
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.currentTarget.value)}
              style={{ minHeight: 160, padding: spacing.sm, borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
            />
          ) : (
            <textarea
              value={comment}
              onChange={(event) => setComment(event.currentTarget.value)}
              placeholder="给回炉、去 AI 味或下一步补充要求…"
              style={{ minHeight: 72, padding: spacing.sm, borderRadius: radius.md, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
            />
          )}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/web/review-checkpoint-card-volume.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/review-checkpoint-card.tsx tests/web/review-checkpoint-card-volume.test.tsx
git commit -m "feat(web): volume-reconcile card with editable proposal + editedText submit"
```

---

## Task 10: 全量回归 + 收尾

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: PASS — 全绿(基线 388 + 本计划新增约 27 个测试)。

- [ ] **Step 2: Type check changed files (no new errors)**

Run: `npx tsc --noEmit 2>&1 | grep -E "src/(domain/volume|agentic/(phases/volume-reconcile|tools/propose-volume-reconcile|events|action-router|agent-runner|agent-service)|db/(client|schema|repositories/review-checkpoints-repo)|server/(review-checkpoint-service|routes/(agent-sessions|review-checkpoints)))|web/components/review-checkpoint-card"`
Expected: 无输出(本计划触及的文件零类型错误;既有的 openai-provider / xxl 等预存错误不在范围内)。

- [ ] **Step 3: Restart backend so the new pipeline + routes go live**

```bash
OLD=$(lsof -ti:4400); [ -n "$OLD" ] && kill $OLD; sleep 1
npm run server   # 后台
```
Verify: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4400/api/books` → `200`.

---

## Self-Review(写计划者自查,已完成)

**1. Spec 覆盖:**
- §5 确定性边界 → T1(纯函数)+ T6(shouldRun)✓
- §4.1 phase 非阻塞 → T2(nonFatal)+ T6 ✓
- §4.2 工具只 emit + 硬校验 → T3 ✓
- §4.3 AgentEvent → T3 ✓
- §4.5 sessions 行补建(FK)→ T7 ✓
- §4.6 payload_json schema+迁移+repo 全链路 → T4 ✓
- §4.4 监听器建卡 + DB 去重 → T5(去重)+ T7(监听)✓
- §4.7 resolve stage 分支 + editedText + 事务幂等 + 越权防护 → T8 ✓
- §4.8 卡片 stage 分支 + editedText → T9 ✓
- §6 对照维度 + 无偏差不调用工具 → T6 prompt ✓
- §7 机器锚点 / 路径越权 / DB 去重 → T8 + T5 ✓
- §10 测试边界 → 分散在各任务的测试 ✓

**2. 占位符扫描:** 无 TBD/TODO;每个改代码的步骤都给了完整代码与确切锚点。

**3. 类型一致性:** `VolumeReconcilePayload` / `getActiveVolumeReconcile` / `createVolumeReconcileCheckpoint` / `RECONCILE_MARKER` / `ensureAgentSessionRow` / `wireReviewCheckpointRequest` / `findVolumeEndingAt` / `parseVolumeChapterRange` 在定义任务(T4/T5/T7/T3/T1)与使用任务(T6/T7/T8)间名称一致。`review-checkpoint-requested` 事件的 `{type, stage, payload}` 形状在 T3(emit)、T7(消费)、events.ts(类型)三处一致。
