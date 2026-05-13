import { useState, createContext, useContext } from 'react'
import { ToastProvider } from './components/ui/toast.js'
import { PromptPage } from './pages/prompt-page.js'
import { AccountsPage } from './pages/accounts-page.js'
import { BooksPage } from './pages/books-page.js'

type Page = 'prompt' | 'books' | 'accounts'
type Theme = 'dark' | 'light'

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} })
export const useTheme = () => useContext(ThemeContext)

const navItems: { key: Page; label: string }[] = [
  { key: 'prompt', label: '执行任务' },
  { key: 'books', label: '书籍管理' },
  { key: 'accounts', label: '账号管理' },
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

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? '浅色模式' : '深色模式'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32,
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 14, color: 'var(--text-secondary)',
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

export function App() {
  const [page, setPage] = useState<Page>('prompt')
  const [theme, setTheme] = useState<Theme>('dark')
  const toggle = () => setTheme((t) => t === 'dark' ? 'light' : 'dark')
  const vars = theme === 'dark' ? darkVars : lightVars

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <ToastProvider>
      <div style={{
        display: 'flex', minHeight: '100vh',
        ...vars, background: 'var(--bg-primary)', color: 'var(--text-primary)',
      }}>
        {/* Sidebar */}
        <aside style={{
          width: 230, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)',
          padding: '20px 0', display: 'flex', flexDirection: 'column', flexShrink: 0,
        }}>
          <div style={{ padding: '0 20px 20px', borderBottom: '1px solid var(--border)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <TomatoLogo size={32} />
            <div>
              <h1 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>Fanqie</h1>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.2 }}>Workbench</p>
            </div>
          </div>
          <nav style={{ flex: 1, padding: '4px 8px' }}>
            {navItems.map((item) => {
              const active = page === item.key
              return (
                <button key={item.key} onClick={() => setPage(item.key)} style={{
                  display: 'flex', alignItems: 'center', width: '100%', padding: '9px 12px', marginBottom: 2,
                  background: active ? 'var(--accent-subtle)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
                  fontSize: 13, fontWeight: active ? 600 : 400, fontFamily: 'inherit', textAlign: 'left',
                }}>
                  {item.label}
                </button>
              )
            })}
          </nav>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v0.1.0</span>
            <ThemeToggle />
          </div>
        </aside>

        {/* Main — all pages always mounted, hidden via display */}
        <main style={{ flex: 1, padding: '32px 40px', maxWidth: 900, overflow: 'auto' }}>
          <div style={{ display: page === 'prompt' ? 'block' : 'none' }}><PromptPage /></div>
          <div style={{ display: page === 'books' ? 'block' : 'none' }}><BooksPage /></div>
          <div style={{ display: page === 'accounts' ? 'block' : 'none' }}><AccountsPage /></div>
        </main>
      </div>
      </ToastProvider>
    </ThemeContext.Provider>
  )
}
