# 市场情报「打通第一阶段」设计

- 日期：2026-06-07
- 状态：已确认，待写实现计划
- 范围：`fanqie-workbench/` 的市场情报（Market Intelligence）功能

## 背景 / 现状

市场情报当前停在「第一阶段半成品」，相关代码：

- `src/web/pages/market-intelligence-page.tsx` —— 6 个扫榜预设按钮 + 「最近扫描结果」列表 + 「趋势分析」占位区。
- `src/server/routes/market-scans.ts` —— `POST /api/market-scans`（跑扫榜）、`GET /api/market-scans`（列出 `data/market-scans/<日期>/*.md`）、`POST /api/market-scans/:scanId/bind-book`（把 md 复制进某本书的 `对标/市场扫描/`）。
- `src/market/market-scan-runner.ts` —— spawn `oh-story-claudecode` 里的爬虫脚本，结果落成 markdown。

已发现的缺口：

1. 列表里的「绑定到书」按钮**没有 onClick**，是死的。
2. **看不了报告**——只显示文件名，点不开、读不到 markdown 内容。
3. `runPreset` **丢弃了 POST 返回**——扫榜失败时 UI 无任何提示。

## 目标

把第一阶段做成「能用」：

1. 能在 UI 里读扫描报告（弹窗渲染 markdown）。
2. 扫榜成功/失败/进行中状态可见。
3. 去掉用不上的「绑定到书」——市场情报是**全局**的，不绑到具体某本书。

## 非目标（超范围，留待第二/三阶段）

- 趋势图表 / 跨日趋势分析（保留现有「趋势分析」占位区，不动）。
- 定时自动扫榜、异步流式进度。
- 把已入库的结构化榜单数据（书/章）做可视化。
- 跨书情报聚合。

## 设计

### ① 看报告（弹窗）

**后端**：新增 `GET /api/market-scans/:scanId/content`

- 返回：`{ fileName: string, content: string }`（content 为原始 markdown 文本）。
- 路径安全：**不信任输入拼路径**。先调 `listMarkdownScans()` 拿到合法 scans，用 `decodeURIComponent(scanId)` 在其中查找；查不到返回 `404 { error: 'market scan not found' }`。命中后才读 `scan.path`。这样杜绝 `../` 路径穿越。
- 编码注意：scanId 形如 `日期/文件名`，含 `/`。前端调用时必须 `encodeURIComponent(scanId)`（`/`→`%2F`）才能安全走路径参数，后端 `decodeURIComponent`（与现有 bind-book 路由一致）。若 Fastify 对编码斜杠的路径参数解析有坑，退路是改用查询参数 `GET /api/market-scans/content?id=...`。
- 文件读失败（已被删等）→ `404`。

**前端**：新增组件 `src/web/components/market-scan-modal.tsx`

- 照搬 `src/web/components/chapter-reader.tsx` 的模式：`fetch('/api/market-scans/:scanId/content')` → `Spinner` 加载态 → `ReactMarkdown` 渲染 → 错误态显示 `error`。
- 弹窗形态：页面变暗遮罩 + 居中卡片 + 标题（fileName）+ ✕ 关闭，支持 `Esc` 关闭、点遮罩关闭。
- 触发：`market-intelligence-page.tsx` 中点击某条扫描结果行 → 设置 `openScanId` → 渲染 `<MarketScanModal scanId openScanId onClose>`。
- 弹窗**只读**：不含「绑定 / 导出」等任何动作按钮。

### ② 扫榜失败 / 进度可见

改 `market-intelligence-page.tsx` 的 `runPreset`：

- 现状：`await fetch(...POST...)` 后直接 `loadScans()`，无视返回。
- 改为：await + `response.json()` 解析：
  - HTTP `!response.ok` **或** body `status === 'failed'` → `toast` 报错（复用 `src/web/components/ui/toast.tsx`），显示 `body.error` 摘要（首行/截断）。
  - 成功 → `toast`「扫描完成：N 个结果」（N = `outputFiles.length`）+ `loadScans()` 刷新列表。
- 「扫描中…」禁用态（现有 `running` 状态）保留。

### ③ 去掉「绑定到书」

- 删 `market-intelligence-page.tsx` 列表行里的死 `<button>绑定到书</button>`。
- 删后端 `POST /api/market-scans/:scanId/bind-book` 路由（前端无人调用，仅 `tests/server/market-scans-route.test.ts` 引用）。
- 同步删 `tests/server/market-scans-route.test.ts` 中对应 bind-book 的用例。
- 更新页面文案：`<p>第一阶段先接入手动扫榜和 Markdown 结果绑定。</p>` → 去掉「绑定」措辞（如「手动扫榜，点结果可查看报告。」）。

## 错误处理

- content 接口：scanId 查不到 / 文件读失败 → 404；前端弹窗显示错误态而非崩溃。
- 路径穿越：只认 `listMarkdownScans()` 列出的 id，绝不用输入直接拼路径读盘。
- 扫榜 stderr 可能很长：toast 只显示首行/截断，完整错误打到 console 备查。

## 测试

- **后端**（`tests/server/market-scans-route.test.ts`，沿用现有风格）：
  - `GET /content` 有效 scanId → 返回 `{ fileName, content }`。
  - 无效 scanId → 404。
  - 路径穿越尝试（如 `..%2F..%2Fetc%2Fpasswd`）→ 404，不读到盘外文件。
  - 删除原 bind-book 用例。
- **前端**（沿用现有组件测试风格）：
  - 弹窗：打开 → 渲染 markdown；加载/错误态。
  - 扫榜失败 → 触发 toast。

## 受影响文件清单

新增：
- `src/web/components/market-scan-modal.tsx`

修改：
- `src/server/routes/market-scans.ts`（+content 接口，−bind-book 接口）
- `src/web/pages/market-intelligence-page.tsx`（弹窗触发、runPreset toast、删死按钮、改文案）
- `tests/server/market-scans-route.test.ts`（+content 用例，−bind-book 用例）

不动：
- `src/market/market-scan-runner.ts`、`src/market/market-scan-presets.ts`（扫榜管道本身本次不改）
- 「趋势分析」占位区
