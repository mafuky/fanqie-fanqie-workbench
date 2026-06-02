# 卷末对账(Volume-End Reconciliation)设计

**Goal:** 写作进展到「卷末」时,自动对比该卷的「计划(卷纲)vs 实际(已写各章)」,**仅在存在实质偏差时**生成一份对账报告,经 review_checkpoint HITL 让用户确认后,**append-only** 追加进卷纲(必要时附一句到总纲),帮作者卷间复盘而不破坏原计划。

**Architecture:** 在 `chapter.next` / `chapter.continue` 写作 pipeline 末尾新增一个 **非阻塞** 的 `volume-reconcile` phase;它用**机器可读的卷章节范围**做确定性触发(不烧模型当判官),仅当本章是某卷末章且该卷尚未对账时,让模型对照计划与实际产出「偏差报告」;报告经一个**只发事件不碰 DB** 的工具上抛,由路由侧监听器建成 review_checkpoint;用户在卡片里确认后,resolve 路由在事务内 append 到卷纲。对账失败**绝不影响**正文落盘、stage 推进与 run 成功。

**Tech Stack:** TypeScript/Node, Fastify(:4400), React/Vite, better-sqlite3, vitest。复用既有 `agent-runner` 事件总线、`review_checkpoints` 表与卡片组件、`wireStageAdvance` 监听模式。

---

## 1. 背景与现状(已核对代码)

- 长篇大纲结构:`大纲/卷纲_第X卷.md`(X 为中文数字)+ 顶层大纲(`大纲/总纲.md`,无则 `大纲/大纲.md`)。卷纲含 本卷目标/爽点节奏/情绪弧线/人物弧线/伏笔布局/关键反转/本卷功能,且**卷纲首部与总纲「卷级结构」表都写了机器可读的 `章节范围:第X-Y章`**(全/半角冒号与空格混用,需容错正则)。
- `review_checkpoints` 全套(表/服务/路由/卡片)早已存在,但 `createChapterCompleteReviewCheckpoint` **零调用** —— 本功能是第一个真正点亮该 HITL 的特性,因此是「改造」而非「接线」。
- 事件总线:`agent-runner` 所有事件打在单一 `'event'` 通道(`agent-runner.ts:54`);路由侧已有 `wireStageAdvance`(`agent-sessions.ts`)监听 `'event'` 且 `if ev.type==='done'`。工具 `ctx.emit` 与 runner `emit` 同一函数,工具发的事件路由能收到。
- `AgentEvent` 是封闭联合(`events.ts`,12 个 type),且 runner 会把非 delta 事件序列化进 trace。
- `review_checkpoints.session_id` 为 `NOT NULL` 且 FK→`sessions(id)`;但 agent run 只建 trace 行、**从不建 sessions 行**(唯一 `createSession` 在 chapter-action-service,仅 resolve 的部分分支命中)。`sessions` 表必填仅 id/kind/status/created_at/updated_at,`book_id`/`chapter_id` 可空。
- `chapter.next` 当前 pipeline = `[load-context, write-outline, write-chapter, polish-chapter, update-tracking]`。

## 2. 决策记录

| # | 决策 | 取舍 |
|---|---|---|
| D1 触发 | **确定性边界闸门**:读卷章节范围,本章号==某卷末章 且 该卷未对账 → 触发。模型不再判「是否卷末」 | 每卷一次(非每章),漏判归零,省模型成本。否决了「模型每章判断」(360-450 章每章一次往返、会 miss 现有命名) |
| D2 粒度 | **append-only**,只追加「实际 vs 计划偏差」一节,绝不重写/覆盖原计划 | 非破坏、可审计 |
| D3 落盘时机 | **仅在存在实质偏差时**生成卡片+落盘;完全按计划完成的卷 → 静默 no-op | 高信噪比;实测作者从不回填留痕(3 本书 grep=0),不写无价值水卡 |
| D4 HITL | 复用 review_checkpoint 卡片:可编辑文本框 + [应用追加 / 编辑后应用 / 跳过] | 复用既有卡片/路由设施 |
| D5 范围 | 只动 刚写完的卷纲 + 顶层大纲(总纲优先,无则大纲);后者仅在偏差波及全书主线时 | 「只动该动的」 |

## 3. 数据流

```
chapter.next / chapter.continue  (正文/追踪已落盘)
        │
        ▼
 [volume-reconcile phase]  ── try/catch 全包,异常→no-op,绝不拖垮 run
   1. 读 大纲/:枚举 卷纲_第*卷.md(中文数字↔序号)+ 读各卷 章节范围;读顶层大纲
   2. 算本章号 N 落在哪卷;是否 == 该卷末章?该卷是否已对账(DB 侧查)?
        ├─ 否 / 已对账 / 边界不明 → no-op 结束(零成本)
        └─ 是 & 未对账 ↓
   3. 模型对照「卷纲计划」vs「实际(各章细纲实际完成情况 + 伏笔.md + 角色状态.md)」
        ├─ 无实质偏差 → 模型声明「按计划完成」→ no-op,不弹卡不写
        └─ 有偏差 → 调 propose_volume_reconcile({volumeKey, proposalText, arcNote?})
                      工具硬校验 → ok 则 ctx.emit({type:'review-checkpoint-requested', payload})
        │
        ▼
 [路由监听器 wireReviewCheckpointRequest]  (与 wireStageAdvance 并列, try/catch 仅记日志)
   收到事件 → createVolumeReconcileCheckpoint(db, {sessionId, bookId, chapterId, volumeKey, payload})
   (run 启动时已补建 sessions 行,故 FK 满足;payload 全文存 payload_json)
        │
        ▼  (run 照常 done:succeeded;checkpoint 独立 pending)
 [前端卡片]  GET /api/sessions/:sessionId/review-checkpoint
   stage==='volume-reconcile' → 渲染 proposalText 进可编辑 textarea + 三按钮
        │
        ▼
 [resolve 路由]  POST /api/review-checkpoints/:id/resolve  {action, editedText?}
   按 checkpoint.stage 分支(chapterId 校验下沉到 chapter-complete 分支):
     apply        → 事务内 pending→accepted(changes===1)→ append proposalText 到卷纲(+arcNote 到总纲)
     apply-edited → 同上,但 append body.editedText
     skip         → 标 dismissed,不写文件
```

## 4. 组件分解

### 4.1 `volume-reconcile` phase(`src/agentic/phases/volume-reconcile.ts`,新建)
- 挂入 `action-router`:`chapter.next` 与 `chapter.continue` 末尾追加 `volumeReconcilePhase`。
- `tools: ['read_file', 'list_dir', 'grep', 'propose_volume_reconcile']`,低 `maxIterations`。
- **关键不变量:phase 的 `systemPrompt`/`verify`/`onComplete` 全部包 try/catch;任何异常 → 记日志并 no-op 返回**,不得抛出(否则 `agent-runner.ts:171-182` 会把整 run 标 failed → 正文已写但 stage 永停「待写作」=鬼章节)。verify 不设硬 gate。
- 卷边界解析(确定性,见 §5)。判定不触发 → 直接输出「本卷未到边界/已对账」并结束。
- 触发后,prompt 引导模型:读各章**细纲的「实际完成情况」**(与章级同口径,Rule 4)+ `追踪/伏笔.md` + `追踪/角色状态.md`,对照卷纲计划维度(见 §6);**无实质偏差则不调用工具**,有偏差才调 `propose_volume_reconcile`。

### 4.2 `propose_volume_reconcile` 工具(`src/agentic/tools/propose-volume-reconcile.ts`,新建)
- 参数:`{ volumeKey: string, proposalText: string, arcNote?: string }`。**只 emit 不碰 DB**(对齐 `update_tracking` 工具职责)。
- **硬校验**:`proposalText` trim 后长度 ≥ 40 字 且必含约定小节标题 `## 实际完成 vs 计划偏差(对账)`;不满足 → 返回 `{ok:false, error}` 让模型重试(对齐 update_tracking 对空串的处理)。
- 通过 → `ctx.emit({ type:'review-checkpoint-requested', stage:'volume-reconcile', payload:{ volumeKey, proposalText, arcNote } })`,返回 `{ok:true}`。
- **不 emit 任何文件绝对路径**;落盘路径由 resolve 侧用 bookId 反查重拼(防越权,见 §7)。

### 4.3 `AgentEvent` 扩展(`src/agentic/events.ts`)
新增联合分支:
```ts
| { type: 'review-checkpoint-requested'; stage: 'volume-reconcile';
    payload: { volumeKey: string; proposalText: string; arcNote?: string } }
```
runner 仍会把它 append 进 trace(可接受:它是结构化、可回放的)。

### 4.4 路由监听器 `wireReviewCheckpointRequest`(`src/server/routes/agent-sessions.ts`)
- 仿 `wireStageAdvance`:在**写作 run 启动处**(`chapter-next` handler + 通用 `/api/agent-sessions` handler)`emitter.on('event', …)`,`if ev.type==='review-checkpoint-requested'` → 调 `createVolumeReconcileCheckpoint(deps.db, {sessionId, bookId, chapterId, payload})`。**try/catch 仅记日志**(建卡失败绝不影响 run)。
- 去重(DB 侧,见 §7):建卡前查 `(bookId, volumeKey)` 是否已有非 dismissed 的 volume-reconcile 记录,有则跳过。

### 4.5 sessions 行补建(FK blocker 修复)
- 在 `agent-sessions.ts` 的两个写作 run 启动处(`chapter-next` handler + 通用 `/api/agent-sessions` handler)生成 `sessionId` 后,补 `INSERT INTO sessions (id, kind, book_id, chapter_id, status, created_at, updated_at)`,`kind='agent'`、`status='running'`。使 `review_checkpoints.session_id` FK 满足,且让现有 `getPendingReviewCheckpointBySessionId(sessionId)` 卡片查询天然可用。
- 这两个 handler 启动的均为 chapter.* run;`kind='agent'` 与既有 HITL session 区分,避免污染会话列表语义。`book-create` handler 不产对账,不补建。

### 4.6 `review_checkpoints` 持久层(`schema.ts` + `client.ts` 迁移 + `review-checkpoints-repo.ts`)
- 新增可空列 `payload_json TEXT`,**两处同步**:
  - `src/db/schema.ts` 的 `CREATE TABLE review_checkpoints` 加 `payload_json TEXT`(fresh DB / :memory: 夹具走 schema)。
  - `src/db/client.ts` `additiveMigrations` 加 `{table:'review_checkpoints', column:'payload_json', sql:'ALTER TABLE …'}`(`existingTablesBeforeSchema` 已含该表,老库走迁移)。
- 类型 / 列清单全链路带上 `payload`:`ReviewCheckpointStage` 扩为联合 `'chapter-complete' | 'volume-reconcile'`;`ReviewCheckpointOption` 扩为加 `'apply' | 'apply-edited' | 'skip'`;`ReviewCheckpointRow`/`ReviewCheckpointRecord` 加字段;`createReviewCheckpoint` INSERT、两处手维护的 SELECT 列清单、`mapReviewCheckpointRow` 全部加 `payload_json`。
- `parsePayload`:容忍 `NULL`/空/字面 `'undefined'` 不抛(NULL=legacy/chapter-complete 行),校验 `volumeKey`/`proposalText` 为非空字符串;顺手给 `parseSummary`/`parseJsonArray` 包 try/catch(单行损坏不拖垮整行读取)。
- INSERT 绑定 `input.payload ? JSON.stringify(input.payload) : null`(**绝不** `JSON.stringify(undefined)`)。

### 4.7 resolve 路由(`src/server/routes/review-checkpoints.ts`)
- `resolve()` 改为**先按 `checkpoint.stage` 分支**:
  - `chapter-complete` 分支:保留现有逻辑;`chapterId` 校验仅在此分支。
  - `volume-reconcile` 分支:**不读 chapterId、不调 `updateSessionStatus`**(只负责落盘 + 标 checkpoint 状态)。
- action 白名单改为**按 stage 的 allowlist**(加 `satisfies`/`never` 穷尽断言,避免未来漏改静默 400)。
- Body 类型加 `editedText?: string`。`apply` 用 `payload.proposalText`;`apply-edited` 用 `editedText`(缺失则 400 或回退 apply);`skip` 标 dismissed。
- 落盘见 §7(事务幂等 + 路径越权防护 + 机器锚点)。

### 4.8 前端卡片(`src/web/components/review-checkpoint-card.tsx`)
- `ReviewAction` 改为**从 repo import**(单一真源,前后端不漂移),加 `apply/apply-edited/skip` label。
- `checkpoint.stage==='volume-reconcile'` 分支渲染:预填 `payload.proposalText` 的**独立** `editedText` textarea(不复用绑定 `comment` 的现有框) + 三按钮;`apply-edited` 提交 `{action, editedText}`。
- 前端 `ReviewCheckpoint` 类型加 `payload` 字段。

## 5. 卷边界解析(确定性)

- `list_dir 大纲/`,用 `/^卷纲_第(.+)卷\.md$/` 枚举;`(.+)` 为中文数字,经 中文数字↔整数 映射得卷号。
- 每个卷纲读 `章节范围`,容错正则匹配 `第\s*(\d+)\s*[-—~]\s*(\d+)\s*章`,冒号全/半角与空格均容忍;总纲「卷级结构」表作为补充来源。
- 由本章号 `N` 唯一定位「`N` 落入 `[起,末]` 的卷」:
  - `N == 末章` 且该卷未对账 → 触发,`volumeKey` = 卷号。
  - `N != 末章` → no-op。
  - `N` 不落任何区间 / 落多个重叠区间 / 范围解析失败 → **显式优雅跳过**(记日志,不触发、不报错)。

## 6. 对账内容(只写偏差)

- 数据源(同口径,避免章级/卷级矛盾):各章**细纲的「实际完成情况」** + `追踪/伏笔.md` + `追踪/角色状态.md`。
- 对照维度:爽点节奏、伏笔布局(计划回收章 vs 实际)、关键反转(计划时点 vs 实际)、情绪弧线、人物弧线,加 **卷末钩子是否兑现**、**核心矛盾是否真收束**。情绪/爽点无读者数据 → 用细纲目标情绪字段 + 章末钩子作代理指标,避免退化成数量核对。
- `proposalText` 形如:
  ```
  ## 实际完成 vs 计划偏差(对账)
  <!-- volume-reconcile:第一卷 -->
  - 伏笔布局:旧钥匙(计划第14章回收)→ 实际仅第5章加深,未回收
  - 关键反转:计划卷末才揭母亲苦衷,实际第5章已透一半
  - 卷末钩子:计划「误会最亲近的人」→ 已兑现
  ```
- **无实质偏差** → 模型不调用工具,phase no-op。

## 7. 落盘、幂等、安全

- **事务幂等**(resolve apply/apply-edited):单个 better-sqlite3 transaction 内 `校验 status=pending → UPDATE pending→accepted 且 changes===1 → 才 append 文件`;`changes===0`(已被并发 resolve)直接返回不写。补测试:同一 pending 连发两次 apply,卷纲只追加一次。
- **路径越权防护**:落盘前用 `checkpoint.bookId` 反查 `books.root_path`,由 `volumeKey` 重拼 `root/大纲/卷纲_第X卷.md` 并 `path.resolve` 校验落在 `root/大纲` 子树内;**不信任** payload 中任何路径。
- **机器锚点**:append 时带 `<!-- volume-reconcile:第N卷 -->`,与正文物理分离;不依赖自由文本做去重。
- **去重以 DB 为准**:`(bookId, volumeKey)` 已有非 dismissed 的 volume-reconcile 记录 → 不再建卡(覆盖「卡未 resolve 时下一章又触发」「apply-edited 改了锚点」「措辞演进字节不一致」三类失效)。
- **arcNote 边角**:总纲/大纲皆缺失时,卷纲对账照常、arcNote 降级丢弃并在卡片提示「主线对账未写入」,不整体跳过;总纲 `## 对账记录` 追加同样带锚点去重。

## 8. Blocker 解决登记(来自多 agent 设计评审)

| Blocker | 解决 |
|---|---|
| 事件通道不存在 | §4.4 新增 `wireReviewCheckpointRequest` 监听,两处 run 启动并列挂载 |
| AgentEvent 封闭联合 | §4.3 加新分支 |
| FK session_id→sessions | §4.5 run 启动补建 `kind='agent'` 的 sessions 行 |
| resolve chapterId 硬阻断 | §4.7 chapterId 校验下沉到 chapter-complete 分支 |
| resolve action 白名单 | §4.7 按 stage allowlist + 穷尽断言 |
| apply-edited 无回传 | §4.7 Body 加 `editedText`,前端独立 state |
| phase 抛错拖垮日更 | §4.1 try/catch 全包、异常 no-op;补测试「对账抛错时 run 仍 succeeded」 |
| schema/迁移双写 | §4.6 schema.ts + client.ts 同步加列 + legacy 升级回归测试 |
| repo 列清单全链路 | §4.6 INSERT/两处 SELECT/map/类型全带 payload |

## 9. 错误处理与「非阻塞旁路」语义

- 对账是 run 主循环外的**非阻塞旁路**:即便对账完全失败,run 照常 `done:succeeded`、stage 已由 `wireStageAdvance` 推进、`activeBookIds` 已释放。
- `skip` 不回滚任何东西,只标 `dismissed`。
- 确认 `getPendingReviewCheckpointBySessionId` 在 session 已 `succeeded` 后仍能取到 pending 卡(它只按 `status='pending'` 过滤,不看 session 状态 ✓)。
- 误触发安全:确定性闸门已基本消除误触发;即便发生,产物只是一张可 skip 的卡。

## 10. 测试计划(关键边界)

1. 卷边界解析:中文数字命名命中;`章节范围` 全/半角冒号 + 空格容错;章号不落区间/重叠区间 → 优雅跳过。
2. 触发闸门:N==末章且未对账 → 触发;N!=末章 → no-op;已对账(DB 有记录)→ no-op。
3. 工具:空/超短/缺小节标题的 proposalText → `ok:false` 不建卡;合法 → emit 形状正确。
4. phase 韧性:对账内部抛错 → run 仍 `succeeded`、stage 仍推进。
5. 路由监听:收到事件建出 volume-reconcile checkpoint(payload 落库)。
6. 持久层:legacy 库(无列)`openDatabase` 后 PRAGMA 有 `payload_json`;:memory: 夹具也有;payload roundtrip;NULL/损坏不抛。
7. resolve:`apply` 真把文本追加进卷纲(且带锚点);`apply-edited` 用 editedText;`skip` 不写;同一 pending 连发两次 apply 只追加一次;路径越权(payload 给越权路径)被拒。
8. 顶层大纲名:`总纲.md` 与 `大纲.md` 两种都命中;皆缺失时 arcNote 降级。
9. 前端卡片:stage 分支渲染可编辑 textarea + 三按钮;apply-edited 提交 editedText。

## 11. 明确不做(MVP 范围外)

- apply 后「要不要顺手据偏差调整第 N+1 卷卷纲」的卷间衔接(复用开新卷分支)——记为后续。
- volume-reconcile 顺手产「上下文.md 卷级一句话总览」——记为后续。
- 同一 run 同时存在 chapter-complete + volume-reconcile 两张卡的共存队列(当前 chapter-complete 零调用,MVP 维持「同 run 至多一张 pending」不变量;建 volume-reconcile 前若有旧 pending 标 superseded)。

## 12. 文件清单

**新建**
- `src/agentic/phases/volume-reconcile.ts`
- `src/agentic/tools/propose-volume-reconcile.ts`
- `src/domain/volume.ts`(卷纲枚举 / 中文数字映射 / 章节范围解析 / 边界判定 —— 纯函数,易测)

**修改**
- `src/agentic/events.ts`(AgentEvent 新分支)
- `src/agentic/action-router.ts`(两条 pipeline 末尾加 phase)
- `src/agentic/agent-service.ts`(`tools.register(proposeVolumeReconcileTool)` —— 工具注册处,与现有 `tools.register(updateTrackingTool)` 并列)
- `src/db/schema.ts` + `src/db/client.ts`(payload_json:schema + 迁移)
- `src/db/repositories/review-checkpoints-repo.ts`(类型/列/map/parse/去重查询)
- `src/server/review-checkpoint-service.ts`(`createVolumeReconcileCheckpoint`)
- `src/server/routes/agent-sessions.ts`(`wireReviewCheckpointRequest` + sessions 行补建)
- `src/server/routes/review-checkpoints.ts`(按 stage 分支 + editedText + 落盘 + 幂等 + 越权防护)
- `src/web/components/review-checkpoint-card.tsx`(stage 分支 UI + import ReviewAction)
