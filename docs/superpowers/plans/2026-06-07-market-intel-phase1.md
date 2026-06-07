# 市场情报第一阶段打通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把市场情报功能从半成品做成能用——能在 UI 弹窗里读扫描报告、扫榜成功/失败可见、去掉用不上的「绑定到书」。

**Architecture:** 后端 Fastify 加一个只读 `GET /api/market-scans/:scanId/content` 接口（路径穿越防护），删掉无人用的 `bind-book` 接口；前端加一个只读 `MarketScanModal`（照搬 `chapter-reader` 的弹窗+ReactMarkdown 模式），并把市场情报页的扫榜按钮接上 toast、列表行点开弹窗、删掉死按钮。

**Tech Stack:** TypeScript, Fastify, React, react-markdown, vitest, @testing-library/react。

**约定：**
- 所有命令在 `fanqie-workbench/` 目录下执行。
- git 仓库根在上一级（`tomato 写作/`），`git add <相对 fanqie-workbench 的路径>` 可正常工作。
- **commit message 不加 `Co-Authored-By: Claude` 之类的 AI 署名**（本仓库约定）。

---

## File Structure

新增：
- `fanqie-workbench/src/web/components/market-scan-modal.tsx` —— 只读报告弹窗组件。
- `fanqie-workbench/tests/web/market-scan-modal.test.tsx` —— 弹窗组件测试。
- `fanqie-workbench/tests/web/market-intelligence-page.test.tsx` —— 页面交互测试。

修改：
- `fanqie-workbench/src/server/routes/market-scans.ts` —— +content 接口，−bind-book 接口。
- `fanqie-workbench/tests/server/market-scans-route.test.ts` —— +content 用例，−bind-book 用例。
- `fanqie-workbench/src/web/pages/market-intelligence-page.tsx` —— 弹窗触发、runPreset toast、删死按钮、改文案。

不动：`src/market/market-scan-runner.ts`、`market-scan-presets.ts`、「趋势分析」占位区。

---

## Task 1: 后端 `GET /api/market-scans/:scanId/content` 接口

**Files:**
- Modify: `fanqie-workbench/src/server/routes/market-scans.ts`
- Test: `fanqie-workbench/tests/server/market-scans-route.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/server/market-scans-route.test.ts` 的 `describe('market scans route', ...)` 块内、最后一个 `it(...)` 之后，加入三个用例：

```ts
  it('returns markdown content for a valid scanId', async () => {
    await createFixture('content')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'GET',
      url: '/api/market-scans/2026-05-18%2Ffanqie-female-reading.md/content',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.fileName).toBe('fanqie-female-reading.md')
    expect(body.content).toContain('番茄女频阅读榜')

    await app.close()
  })

  it('returns 404 for an unknown scanId', async () => {
    await createFixture('content-404')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'GET',
      url: '/api/market-scans/2026-05-18%2Fdoes-not-exist.md/content',
    })

    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('does not serve files outside the scan root (path traversal)', async () => {
    await createFixture('content-traversal')
    const { buildServer } = await import('../../src/server/app.js')
    const app = await buildServer()

    const response = await app.inject({
      method: 'GET',
      url: '/api/market-scans/' + encodeURIComponent('../../../../etc/passwd') + '/content',
    })

    expect(response.statusCode).toBe(404)
    await app.close()
  })
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/server/market-scans-route.test.ts`
Expected: 新增 3 个用例 FAIL（content 接口未定义 → 404 或 500，`fileName`/`content` 断言不通过）。

- [ ] **Step 3: 实现 content 接口**

在 `src/server/routes/market-scans.ts` 的 `registerMarketScanRoutes` 内，`app.get('/api/market-scans', ...)` 之后加入：

```ts
  app.get<{ Params: { scanId: string } }>('/api/market-scans/:scanId/content', async (request, reply) => {
    const scans = await listMarkdownScans()
    const scan = scans.find((item) => item.id === decodeURIComponent(request.params.scanId))
    if (!scan) return reply.code(404).send({ error: 'market scan not found' })
    try {
      const content = await readFile(scan.path, 'utf8')
      return { fileName: scan.fileName, content }
    } catch {
      return reply.code(404).send({ error: 'market scan not found' })
    }
  })
```

在文件顶部的 `node:fs/promises` import 中加入 `readFile`（这一步先只加，不删别的；删除在 Task 2）：

```ts
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises'
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/server/market-scans-route.test.ts`
Expected: 全部 PASS（含原有 bind-book 用例仍在）。

- [ ] **Step 5: 提交**

```bash
git add src/server/routes/market-scans.ts tests/server/market-scans-route.test.ts
git commit -m "feat(market-scans): add read-only GET /:scanId/content endpoint"
```

---

## Task 2: 删除无人用的 `bind-book` 接口

**Files:**
- Modify: `fanqie-workbench/src/server/routes/market-scans.ts`
- Test: `fanqie-workbench/tests/server/market-scans-route.test.ts`

- [ ] **Step 1: 删除 bind-book 测试用例**

在 `tests/server/market-scans-route.test.ts` 中删除整个 `it('binds a scan markdown file to a book', ...)` 用例（约第 75–92 行那一段）。

- [ ] **Step 2: 删除 bind-book 路由与随之无用的代码**

把 `src/server/routes/market-scans.ts` 整体改成下面这样（删掉 bind-book 路由、`getDatabasePath`、不再使用的 import）：

```ts
import type { FastifyInstance } from 'fastify'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runMarketScan } from '../../market/market-scan-runner.js'

function getWorkspaceRoot() {
  return process.env.WORKBENCH_ROOT || resolve(import.meta.dirname, '..', '..', '..', '..')
}

function getScanRoot() {
  return resolve(getWorkspaceRoot(), 'fanqie-workbench', 'data', 'market-scans')
}

async function listMarkdownScans() {
  const root = getScanRoot()
  const dates = await readdir(root).catch(() => [])
  const scans: Array<{ id: string; date: string; fileName: string; path: string }> = []
  for (const date of dates) {
    const dateDir = resolve(root, date)
    const files = await readdir(dateDir).catch(() => [])
    for (const fileName of files.filter((file) => file.endsWith('.md'))) {
      scans.push({ id: `${date}/${fileName}`, date, fileName, path: resolve(dateDir, fileName) })
    }
  }
  return scans.sort((a, b) => b.id.localeCompare(a.id))
}

export async function registerMarketScanRoutes(app: FastifyInstance) {
  app.post<{ Body: { preset?: string } }>('/api/market-scans', async (request, reply) => {
    if (!request.body?.preset) return reply.code(400).send({ error: 'preset is required' })
    try {
      return await runMarketScan({ preset: request.body.preset, workspaceRoot: getWorkspaceRoot() })
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get('/api/market-scans', async () => ({ scans: await listMarkdownScans() }))

  app.get<{ Params: { scanId: string } }>('/api/market-scans/:scanId/content', async (request, reply) => {
    const scans = await listMarkdownScans()
    const scan = scans.find((item) => item.id === decodeURIComponent(request.params.scanId))
    if (!scan) return reply.code(404).send({ error: 'market scan not found' })
    try {
      const content = await readFile(scan.path, 'utf8')
      return { fileName: scan.fileName, content }
    } catch {
      return reply.code(404).send({ error: 'market scan not found' })
    }
  })
}
```

- [ ] **Step 3: 运行该路由测试 + 全量测试，确认无回归**

Run: `npx vitest run tests/server/market-scans-route.test.ts`
Expected: PASS（无 bind-book 用例；content/list/post 全过）。

Run: `npx vitest run`
Expected: 全量 PASS。重点确认 `tests/publish/*` 与 `tests/server/book-publications-route.test.ts` 不受影响（它们的 "bind" 概念与本接口无关，应仍 PASS）。

- [ ] **Step 4: 提交**

```bash
git add src/server/routes/market-scans.ts tests/server/market-scans-route.test.ts
git commit -m "refactor(market-scans): drop unused per-book bind-book endpoint"
```

---

## Task 3: 前端 `MarketScanModal` 只读报告弹窗

**Files:**
- Create: `fanqie-workbench/src/web/components/market-scan-modal.tsx`
- Test: `fanqie-workbench/tests/web/market-scan-modal.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `tests/web/market-scan-modal.test.tsx`：

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MarketScanModal } from '../../src/web/components/market-scan-modal.js'

describe('MarketScanModal', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the report markdown', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ fileName: '番茄女频.md', content: '# 榜单 TOP50' }),
    }))

    render(<MarketScanModal scanId="2026-06-07/番茄女频.md" onClose={vi.fn()} />)

    expect(await screen.findByText('榜单 TOP50')).toBeTruthy()
  })

  it('shows an error when content fails to load', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'market scan not found' }),
    }))

    render(<MarketScanModal scanId="2026-06-07/missing.md" onClose={vi.fn()} />)

    expect(await screen.findByText(/加载失败：market scan not found/)).toBeTruthy()
  })

  it('calls onClose on Escape', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ fileName: 'x.md', content: 'x' }),
    }))
    const onClose = vi.fn()

    render(<MarketScanModal scanId="2026-06-07/x.md" onClose={onClose} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/web/market-scan-modal.test.tsx`
Expected: FAIL（`MarketScanModal` 模块不存在 / 找不到）。

- [ ] **Step 3: 实现组件**

新建 `src/web/components/market-scan-modal.tsx`：

```tsx
import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Spinner } from './ui/spinner.js'
import { spacing, fontSize, fontWeight, radius, transition } from '../styles/tokens.js'

type Props = {
  scanId: string
  onClose: () => void
}

type ScanContent = { fileName: string; content: string }

export function MarketScanModal({ scanId, onClose }: Props) {
  const [data, setData] = useState<ScanContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/market-scans/${encodeURIComponent(scanId)}/content`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        return res.json()
      })
      .then((payload) => {
        if (!cancelled) {
          setData(payload as ScanContent)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [scanId])

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [])

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'stretch',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 880,
          margin: '32px auto',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: radius.lg,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        <header
          style={{
            padding: `${spacing.lg}px ${spacing['2xl']}px`,
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: fontSize.xl,
              fontWeight: fontWeight.bold,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {data?.fileName ?? '加载中…'}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭报告"
            style={{
              width: 32,
              height: 32,
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: radius.sm,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              transition: `background ${transition.normal}`,
            }}
          >
            ×
          </button>
        </header>

        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: `${spacing['3xl']}px ${spacing['4xl']}px`,
            background: 'var(--bg-primary)',
          }}
        >
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: spacing['4xl'] }}>
              <Spinner />
            </div>
          )}
          {error && (
            <div
              style={{
                color: 'var(--red)',
                padding: spacing.lg,
                background: 'var(--red-subtle)',
                borderRadius: radius.sm,
              }}
            >
              加载失败：{error}
            </div>
          )}
          {data && (
            <article className="chapter-prose" style={{ color: 'var(--text-primary)', fontSize: 15, lineHeight: 1.8 }}>
              <ReactMarkdown>{data.content}</ReactMarkdown>
            </article>
          )}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/web/market-scan-modal.test.tsx`
Expected: 3 个用例全 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/web/components/market-scan-modal.tsx tests/web/market-scan-modal.test.tsx
git commit -m "feat(market-intel): read-only MarketScanModal for viewing scan reports"
```

---

## Task 4: 接通市场情报页（弹窗触发 + toast + 删死按钮 + 改文案）

**Files:**
- Modify: `fanqie-workbench/src/web/pages/market-intelligence-page.tsx`
- Test: `fanqie-workbench/tests/web/market-intelligence-page.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `tests/web/market-intelligence-page.test.tsx`：

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider } from '../../src/web/components/ui/toast.js'
import { MarketIntelligencePage } from '../../src/web/pages/market-intelligence-page.js'

const ONE_SCAN = { id: '2026-06-07/番茄女频.md', date: '2026-06-07', fileName: '番茄女频.md' }

describe('MarketIntelligencePage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows an error toast when a scan fails', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/market-scans' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ status: 'failed', preset: 'fanqie-female-reading', error: '脚本崩了' }) }
      }
      if (input === '/api/market-scans') {
        return { ok: true, json: async () => ({ scans: [] }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(
      <ToastProvider>
        <MarketIntelligencePage />
      </ToastProvider>,
    )
    fireEvent.click(await screen.findByText('番茄女频阅读榜'))

    expect(await screen.findByText(/扫描失败：脚本崩了/)).toBeTruthy()
  })

  it('opens a modal rendering the report when a result row is clicked', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/market-scans') {
        return { ok: true, json: async () => ({ scans: [ONE_SCAN] }) }
      }
      if (input === `/api/market-scans/${encodeURIComponent(ONE_SCAN.id)}/content`) {
        return { ok: true, json: async () => ({ fileName: '番茄女频.md', content: '# 榜单 TOP50' }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(
      <ToastProvider>
        <MarketIntelligencePage />
      </ToastProvider>,
    )
    fireEvent.click(await screen.findByText('番茄女频.md'))

    expect(await screen.findByText('榜单 TOP50')).toBeTruthy()
  })

  it('no longer renders the 绑定到书 button', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ scans: [ONE_SCAN] }),
    }))

    render(
      <ToastProvider>
        <MarketIntelligencePage />
      </ToastProvider>,
    )
    await screen.findByText('番茄女频.md')

    expect(screen.queryByText('绑定到书')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/web/market-intelligence-page.test.tsx`
Expected: FAIL（失败 toast 不出现、点行无弹窗、`绑定到书` 仍在）。

- [ ] **Step 3: 改写页面**

把 `src/web/pages/market-intelligence-page.tsx` 整体替换为：

```tsx
import { useEffect, useState } from 'react'
import { spacing, fontSize, radius } from '../styles/tokens.js'
import { useToast } from '../components/ui/toast.js'
import { MarketScanModal } from '../components/market-scan-modal.js'

const presets = [
  { key: 'fanqie-female-reading', label: '番茄女频阅读榜' },
  { key: 'fanqie-male-reading', label: '番茄男频阅读榜' },
  { key: 'qidian-signnewbook', label: '起点签约作者新书榜' },
  { key: 'qidian-hotsales', label: '起点畅销榜' },
  { key: 'dz-female', label: '点众女频短篇' },
  { key: 'heiyan-booklist', label: '黑岩短篇书库' },
]

type Scan = { id: string; date: string; fileName: string; path?: string }

export function MarketIntelligencePage() {
  const [scans, setScans] = useState<Scan[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [openScanId, setOpenScanId] = useState<string | null>(null)
  const toast = useToast()

  const loadScans = async () => {
    const response = await fetch('/api/market-scans')
    const body = await response.json()
    setScans(body.scans || [])
  }

  useEffect(() => {
    void loadScans()
  }, [])

  const runPreset = async (preset: string) => {
    setRunning(preset)
    try {
      const response = await fetch('/api/market-scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.status === 'failed') {
        const detail = String(body.error ?? `HTTP ${response.status}`)
        if (body.error) console.error('[market-scan]', body.error)
        toast.error(`扫描失败：${detail.split('\n')[0].slice(0, 200)}`)
        return
      }
      toast.success(`扫描完成：${body.outputFiles?.length ?? 0} 个结果`)
      await loadScans()
    } catch (err) {
      toast.error(`扫描失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(null)
    }
  }

  return (
    <section style={{ display: 'grid', gap: spacing.lg }}>
      <header>
        <h1 style={{ margin: 0, fontSize: fontSize.xxl }}>市场情报</h1>
        <p style={{ color: 'var(--text-muted)' }}>手动扫榜，点扫描结果可查看报告。</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: spacing.md }}>
        {presets.map((preset) => (
          <button key={preset.key} onClick={() => void runPreset(preset.key)} disabled={running === preset.key} style={{ padding: spacing.lg, borderRadius: radius.lg, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
            {running === preset.key ? '扫描中…' : preset.label}
          </button>
        ))}
      </div>

      <section style={{ border: '1px solid var(--border)', borderRadius: radius.lg, padding: spacing.lg }}>
        <h2 style={{ marginTop: 0 }}>最近扫描结果</h2>
        {scans.map((scan) => (
          <div
            key={scan.id}
            onClick={() => setOpenScanId(scan.id)}
            style={{ display: 'flex', alignItems: 'center', gap: spacing.md, padding: `${spacing.sm}px 0`, borderTop: '1px solid var(--border)', cursor: 'pointer' }}
          >
            <span>{scan.fileName}</span>
            <span style={{ color: 'var(--text-muted)' }}>{scan.date}</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: fontSize.sm }}>查看报告 →</span>
          </div>
        ))}
        {scans.length === 0 && <div style={{ color: 'var(--text-muted)' }}>暂无扫描结果</div>}
      </section>

      <section style={{ border: '1px dashed var(--border)', borderRadius: radius.lg, padding: spacing.lg, color: 'var(--text-muted)' }}>
        <h2 style={{ marginTop: 0, color: 'var(--text-primary)' }}>趋势分析</h2>
        第一阶段展示扫描结果列表；趋势图表进入第二阶段。
      </section>

      {openScanId && <MarketScanModal scanId={openScanId} onClose={() => setOpenScanId(null)} />}
    </section>
  )
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/web/market-intelligence-page.test.tsx`
Expected: 3 个用例全 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/web/pages/market-intelligence-page.tsx tests/web/market-intelligence-page.test.tsx
git commit -m "feat(market-intel): wire scan-report modal + scan-result toasts; drop dead bind button"
```

---

## Task 5: 全量验证

- [ ] **Step 1: 跑全量测试**

Run: `npx vitest run`
Expected: 全部 PASS（含 `tests/server/market-scans-route.test.ts`、`tests/web/market-scan-modal.test.tsx`、`tests/web/market-intelligence-page.test.tsx`，以及 publish/* 等不相关测试无回归）。

- [ ] **Step 2: 手动冒烟（可选）**

启动开发服务（项目惯例命令），打开「市场情报」页：
1. 点一个扫榜预设 → 成功出 toast「扫描完成：N 个结果」并刷新列表；故意让脚本失败 → 出 toast「扫描失败：…」。
2. 点一条扫描结果 → 弹窗渲染 markdown 报告，✕/Esc/点遮罩可关。
3. 列表行内不再有「绑定到书」按钮。

---

## Self-Review 记录（已核对）

- **Spec 覆盖**：① 看报告→Task 1+3+4；② 失败/进度可见→Task 4 runPreset toast；③ 去掉绑定→Task 2（后端）+ Task 4（前端按钮+文案）。全部有对应任务。
- **占位符**：无 TBD/TODO，所有步骤含完整代码与命令。
- **类型一致**：`ScanContent = { fileName, content }` 在 Task 1 接口返回、Task 3 组件、Task 4 测试三处一致；`MarketScanModal` props `{ scanId, onClose }` 三处一致；content 接口 URL 形如 `/api/market-scans/:scanId/content` 在前后端一致。
