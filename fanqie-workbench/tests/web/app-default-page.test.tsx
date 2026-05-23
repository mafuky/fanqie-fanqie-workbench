import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { beforeEach } from 'vitest'

vi.mock('../../src/web/pages/prompt-page.js', () => ({
  PromptPage: () => <div>PromptPageStub</div>,
}))

vi.mock('../../src/web/pages/books-page.js', () => ({
  BooksPage: () => <div>BooksPageStub</div>,
}))

vi.mock('../../src/web/pages/accounts-page.js', () => ({
  AccountsPage: () => <div>AccountsPageStub</div>,
}))

vi.mock('../../src/web/components/ui/toast.js', () => ({
  ToastProvider: ({ children }: any) => children,
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

describe('App default page', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as any
  })

  it('activates the library nav item by default', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string) => {
      if (input === '/api/books') return { ok: true, json: async () => ({ books: [] }) }
      return { ok: true, json: async () => ({}) }
    })
    const { App } = await import('../../src/web/app.js')
    render(<App />)

    expect((await screen.findByRole('button', { name: '书库' })).getAttribute('data-active')).toBe('true')
    expect(screen.getByRole('button', { name: '设置' }).getAttribute('data-active')).toBe('false')
  })
})
