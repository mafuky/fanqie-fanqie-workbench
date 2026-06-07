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

  it('calls onClose when the backdrop is clicked', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ fileName: 'x.md', content: 'x' }),
    }))
    const onClose = vi.fn()
    const { container } = render(<MarketScanModal scanId="2026-06-07/x.md" onClose={onClose} />)
    fireEvent.click(container.firstChild as Element)
    expect(onClose).toHaveBeenCalled()
  })
})
