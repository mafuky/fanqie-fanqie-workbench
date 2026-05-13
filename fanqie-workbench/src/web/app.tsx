import { useState } from 'react'
import { PromptPage } from './pages/prompt-page.js'
import { AccountsPage } from './pages/accounts-page.js'
import { BooksPage } from './pages/books-page.js'

type Page = 'prompt' | 'books' | 'accounts'

export function App() {
  const [page, setPage] = useState<Page>('prompt')

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, borderBottom: '1px solid #30363d', paddingBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>fanqie-workbench</h1>
        <nav style={{ display: 'flex', gap: 8 }}>
          {(['prompt', 'books', 'accounts'] as Page[]).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              style={{
                padding: '4px 12px',
                background: page === p ? '#238636' : '#21262d',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              {{ prompt: '执行任务', books: '书籍', accounts: '账号' }[p]}
            </button>
          ))}
        </nav>
      </header>

      {page === 'prompt' && <PromptPage />}
      {page === 'books' && <BooksPage />}
      {page === 'accounts' && <AccountsPage />}
    </div>
  )
}
