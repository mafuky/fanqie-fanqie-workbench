import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BookAssetsPanel } from '../../src/web/components/book-assets-panel.js'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const tree = [
  { path: '设定', name: '设定', type: 'dir', children: [
    { path: '设定/世界观.md', name: '世界观.md', type: 'text' },
  ] },
  { path: '封面.png', name: '封面.png', type: 'image' },
]

function mockFetch() {
  return vi.fn(async (input: string) => {
    if (input.endsWith('/assets')) return { ok: true, json: async () => ({ tree }) }
    if (input.includes('/file?path=')) return { ok: true, json: async () => ({ path: '设定/世界观.md', content: '# 世界观正文' }) }
    throw new Error(`unexpected ${input}`)
  })
}

describe('BookAssetsPanel', () => {
  it('renders the asset tree', async () => {
    ;(globalThis as any).fetch = mockFetch()
    render(<BookAssetsPanel bookId="b1" />)
    expect(await screen.findByText('设定')).toBeTruthy()
    expect(await screen.findByText('世界观.md')).toBeTruthy()
    expect(await screen.findByText('封面.png')).toBeTruthy()
  })
  it('loads text content into an editable area when a text node clicked', async () => {
    ;(globalThis as any).fetch = mockFetch()
    render(<BookAssetsPanel bookId="b1" />)
    fireEvent.click(await screen.findByText('世界观.md'))
    const textarea = await screen.findByDisplayValue('# 世界观正文')
    expect(textarea).toBeTruthy()
  })
  it('shows an img when an image node clicked', async () => {
    ;(globalThis as any).fetch = mockFetch()
    const { container } = render(<BookAssetsPanel bookId="b1" />)
    fireEvent.click(await screen.findByText('封面.png'))
    await waitFor(() => {
      const img = container.querySelector('img')
      expect(img).toBeTruthy()
      expect(img?.getAttribute('src')).toContain('/api/books/b1/file?path=')
    })
  })
})
