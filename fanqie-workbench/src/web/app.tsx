import type { ReactNode } from 'react'
import { useState, useEffect, createContext, useContext } from 'react'
import { ToastProvider } from './components/ui/toast.js'
import { PromptPage } from './pages/prompt-page.js'
import { AccountsPage } from './pages/accounts-page.js'
import { BooksPage } from './pages/books-page.js'
import { spacing, fontSize, fontWeight, transition } from './styles/tokens.js'

type Page = 'prompt' | 'books' | 'accounts'
type Theme = 'dark' | 'light'

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} })
export const useTheme = () => useContext(ThemeContext)

const navItems: { key: Page; label: string; icon: ReactNode }[] = [
  {
    key: 'prompt', label: '执行任务',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>,
  },
  {
    key: 'books', label: '书籍管理',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
  },
  {
    key: 'accounts', label: '账号管理',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  },
]

function TomatoLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="36" rx="24" ry="22" fill="#f97316" />
      <ellipse cx="24" cy="30" rx="8" ry="6" fill="white" opacity="0.15" />
      <path d="M32 14 C32 14 30 18 30 20 C30 22 32 22 32 22 C32 22 34 22 34 20 C34 18 32 14 32 14Z" fill="#22c55e" />
      <path d="M26 18 C22 12 18 14 20 18 C22 22 26 20 26 18Z" fill="#16a34a" />
      <path d="M38 18 C42 12 46 14 44 18 C42 22 38 20 38 18Z" fill="#16a34a" />
      <path d="M32 16 C30 10 32 8 34 10 C36 12 34 16 32 16Z" fill="#15803d" />
    </svg>
  )
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: `transform ${transition.normal}`, transform: collapsed ? 'rotate(180deg)' : 'none' }}
    >
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  )
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? '浅色模式' : '深色模式'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32,
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: 8, cursor: 'pointer', fontSize: 14, color: 'var(--text-secondary)',
        transition: `all ${transition.normal}`,
      }}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}

const darkVars: Record<string, string> = {
  '--bg-primary': '#0a0a0b', '--bg-secondary': '#111113', '--bg-tertiary': '#18181b',
  '--bg-elevated': '#1e1e22', '--border': '#27272a', '--border-hover': '#3f3f46',
  '--text-primary': '#fafafa', '--text-secondary': '#a1a1aa', '--text-muted': '#52525b',
  '--accent': '#f97316', '--accent-hover': '#fb923c', '--accent-subtle': 'rgba(249,115,22,0.1)',
  '--green': '#22c55e', '--green-subtle': 'rgba(34,197,94,0.1)',
  '--red': '#ef4444', '--red-subtle': 'rgba(239,68,68,0.1)',
}

const lightVars: Record<string, string> = {
  '--bg-primary': '#f8f9fa', '--bg-secondary': '#ffffff', '--bg-tertiary': '#f0f1f3',
  '--bg-elevated': '#e8eaed', '--border': '#d4d6db', '--border-hover': '#b0b3b8',
  '--text-primary': '#1a1a1a', '--text-secondary': '#5f6368', '--text-muted': '#9aa0a6',
  '--accent': '#ea580c', '--accent-hover': '#f97316', '--accent-subtle': 'rgba(234,88,12,0.08)',
  '--green': '#16a34a', '--green-subtle': 'rgba(22,163,74,0.08)',
  '--red': '#dc2626', '--red-subtle': 'rgba(220,38,38,0.08)',
}

const SIDEBAR_WIDTH = 230
const SIDEBAR_COLLAPSED_WIDTH = 56

export function App() {
  const [page, setPage] = useState<Page>('prompt')
  const [theme, setTheme] = useState<Theme>('dark')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setCollapsed(e.matches)
    handler(mq)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggle = () => setTheme((t) => t === 'dark' ? 'light' : 'dark')
  const vars = theme === 'dark' ? darkVars : lightVars
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <ToastProvider>
      <div style={{
        display: 'flex', minHeight: '100vh',
        ...vars, background: 'var(--bg-primary)', color: 'var(--text-primary)',
      }}>
        {/* Sidebar */}
        <aside style={{
          width: sidebarWidth,
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border)',
          padding: '20px 0',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          transition: `width 0.2s ease`,
          overflow: 'hidden',
        }}>
          {/* Logo */}
          <div style={{
            padding: collapsed ? '0 12px 16px' : '0 20px 16px',
            borderBottom: '1px solid var(--border)',
            marginBottom: spacing.sm,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            minHeight: 40,
          }}>
            <TomatoLogo size={collapsed ? 28 : 32} />
            {!collapsed && (
              <div>
                <h1 style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold, letterSpacing: '-0.02em', lineHeight: 1.2 }}>Fanqie</h1>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.2 }}>Workbench</p>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: `${spacing.xs}px ${collapsed ? 6 : spacing.sm}px` }}>
            {navItems.map((item) => {
              const active = page === item.key
              return (
                <button
                  key={item.key}
                  className="nav-item"
                  data-active={active}
                  onClick={() => setPage(item.key)}
                  title={collapsed ? item.label : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    gap: spacing.md - 2,
                    width: '100%',
                    padding: collapsed ? '10px 0' : '9px 12px',
                    marginBottom: 2,
                    background: 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: fontSize.md,
                    fontWeight: active ? fontWeight.semibold : fontWeight.normal,
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{item.icon}</span>
                  {!collapsed && item.label}
                </button>
              )
            })}
          </nav>

          {/* Footer */}
          <div style={{
            padding: collapsed ? '12px 6px' : '12px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            gap: spacing.sm,
          }}>
            {!collapsed && <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>v0.1.0</span>}
            <div style={{ display: 'flex', gap: spacing.xs }}>
              <ThemeToggle collapsed={collapsed} />
              <button
                onClick={() => setCollapsed((c) => !c)}
                title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32,
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                  borderRadius: 8, cursor: 'pointer', color: 'var(--text-secondary)',
                  transition: `all ${transition.normal}`,
                }}
              >
                <CollapseIcon collapsed={collapsed} />
              </button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main style={{
          flex: 1,
          padding: collapsed ? '28px 24px' : '32px 40px',
          maxWidth: 'min(900px, 100%)',
          overflow: 'auto',
          transition: `padding 0.2s ease`,
        }}>
          <div key={page} className="page-content">
            {page === 'prompt' && <PromptPage />}
            {page === 'books' && <BooksPage />}
            {page === 'accounts' && <AccountsPage />}
          </div>
        </main>
      </div>
      </ToastProvider>
    </ThemeContext.Provider>
  )
}
