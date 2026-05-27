import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MarketIntelligencePage } from '../../src/web/pages/market-intelligence-page.js'

describe('MarketIntelligencePage', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/market-scans' && !init) return { ok: true, json: async () => ({ scans: [{ id: '2026-05-18/fanqie-female-reading.md', fileName: 'fanqie-female-reading.md', date: '2026-05-18' }] }) }
      if (input === '/api/market-scans' && init?.method === 'POST') return { ok: true, json: async () => ({ status: 'succeeded', preset: 'fanqie-female-reading', outputFiles: ['/tmp/fanqie.md'] }) }
      return { ok: true, json: async () => ({}) }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows scan presets', async () => {
    render(<MarketIntelligencePage />)
    expect(await screen.findByText('番茄女频阅读榜')).toBeTruthy()
    expect(screen.getByText('番茄男频阅读榜')).toBeTruthy()
    expect(screen.getByText('起点签约作者新书榜')).toBeTruthy()
    expect(screen.getByText('起点畅销榜')).toBeTruthy()
    expect(screen.getByText('点众女频短篇')).toBeTruthy()
    expect(screen.getByText('黑岩短篇书库')).toBeTruthy()
  })

  it('runs a preset scan', async () => {
    render(<MarketIntelligencePage />)
    fireEvent.click(await screen.findByText('番茄女频阅读榜'))
    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/market-scans', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ preset: 'fanqie-female-reading' }),
      }))
    })
  })

  it('shows recent scan results and bind button', async () => {
    render(<MarketIntelligencePage />)
    expect(await screen.findByText('fanqie-female-reading.md')).toBeTruthy()
    expect(screen.getByText('绑定到书')).toBeTruthy()
    expect(screen.getByText('趋势分析')).toBeTruthy()
  })
})
