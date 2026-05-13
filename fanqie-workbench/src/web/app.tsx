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
      {/* Shadow */}
      <ellipse cx="32" cy="54" rx="16" ry="3" fill="currentColor" opacity="0.06" />
      {/* Body */}
      <ellipse cx="32" cy="35" rx="22" ry="20" fill="#ef4423" />
      {/* Depth gradient overlay */}
      <ellipse cx="32" cy="35" rx="22" ry="20" fill="url(#bodyGrad)" />
      {/* Specular highlight */}
      <ellipse cx="23" cy="28" rx="7" ry="5" fill="white" opacity="0.22" />
      <ellipse cx="21" cy="27" rx="3" ry="2" fill="white" opacity="0.15" />
      {/* Segment lines */}
      <path d="M22 18 Q28 38 26 54" stroke="#d63a1a" strokeWidth="0.7" opacity="0.3" fill="none" />
      <path d="M42 18 Q36 38 38 54" stroke="#d63a1a" strokeWidth="0.7" opacity="0.3" fill="none" />
      {/* Stem */}
      <path d="M31 16 C31 16 30.5 19 31 20.5 C31.5 22 32.5 22 33 20.5 C33.5 19 33 16 33 16Z" fill="#4ade80" />
      {/* Calyx leaves */}
      <path d="M27 17 C23 10 17 11.5 20 16 C23 20.5 27 19 27 17Z" fill="#22c55e" />
      <path d="M37 17 C41 10 47 11.5 44 16 C41 20.5 37 19 37 17Z" fill="#22c55e" />
      <path d="M32 15 C30 8 32 5 34 8 C36 11 34 15 32 15Z" fill="#16a34a" />
      {/* Leaf vein details */}
      <path d="M23 14 Q25 16 27 17" stroke="#15803d" strokeWidth="0.5" opacity="0.5" fill="none" />
      <path d="M41 14 Q39 16 37 17" stroke="#15803d" strokeWidth="0.5" opacity="0.5" fill="none" />
      <defs>
        <radialGradient id="bodyGrad" cx="0.35" cy="0.3" r="0.65">
          <stop offset="0%" stopColor="#ff6b3d" stopOpacity="0.4" />
          <stop offset="50%" stopColor="#ef4423" stopOpacity="0" />
          <stop offset="100%" stopColor="#b91c0c" stopOpacity="0.3" />
        </radialGradient>
      </defs>
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

function getTimeBasedTheme(): Theme {
  const hour = new Date().getHours()
  return (hour >= 6 && hour < 18) ? 'light' : 'dark'
}

export function App() {
  const [page, setPage] = useState<Page>('prompt')
  const [theme, setTheme] = useState<Theme>(getTimeBasedTheme)
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
            gap: 10,
            minHeight: 40,
          }}>
            <div style={{
              width: collapsed ? 32 : 36,
              height: collapsed ? 32 : 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(239,68,68,0.08))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: `all ${transition.normal}`,
            }}>
              <TomatoLogo size={collapsed ? 22 : 26} />
            </div>
            {!collapsed && (
              <div>
                <h1 style={{
                  fontSize: fontSize.lg,
                  fontWeight: fontWeight.bold,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.2,
                  background: 'linear-gradient(135deg, var(--text-primary), var(--accent))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>小番茄写作</h1>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.2, letterSpacing: '0.02em' }}>AI 网文工作台</p>
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
