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

  it('shows a success toast after a successful scan', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/market-scans' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ status: 'succeeded', preset: 'fanqie-female-reading', outputFiles: ['/a.md', '/b.md'] }) }
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

    expect(await screen.findByText(/扫描完成：2 个结果/)).toBeTruthy()
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
