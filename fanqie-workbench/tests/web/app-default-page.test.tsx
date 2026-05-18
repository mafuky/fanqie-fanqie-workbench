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

  it('activates the books nav item by default', async () => {
    const { App } = await import('../../src/web/app.js')
    render(<App />)

    expect((await screen.findByRole('button', { name: '书籍管理' })).getAttribute('data-active')).toBe('true')
    expect(screen.getByRole('button', { name: '自由会话' }).getAttribute('data-active')).toBe('false')
  })
})
