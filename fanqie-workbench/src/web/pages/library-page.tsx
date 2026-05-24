import { useCallback, useEffect, useState } from 'react'
import { BookCreationModal } from '../components/book-creation-modal.js'
import { ClaudeExecutionPanel } from '../components/claude-execution-panel.js'
import { spacing, fontSize, radius } from '../styles/tokens.js'

type Book = { id: string; title: string; root_path: string; account_id: string | null }

export function LibraryPage({ onOpenBook }: { onOpenBook: (bookId: string) => void }) {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [bookCreationOpen, setBookCreationOpen] = useState(false)
  const [bookCreationLoading, setBookCreationLoading] = useState(false)
  const [bookEntrySessionId, setBookEntrySessionId] = useState<string | null>(null)

  const loadBooks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/books')
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '加载书库失败')
      setBooks(body.books || [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBooks()
    void (async () => {
      try {
        const res = await fetch('/api/sessions?kind=prompt')
        const body = await res.json().catch(() => ({}))
        const active = (body.sessions || []).find((s: any) =>
          s.currentSkill === 'book-entry' && (s.status === 'running' || s.status === 'waiting-answer')
        )
        if (active) setBookEntrySessionId(active.id)
      } catch {}
    })()
  }, [loadBooks])

  const scanBooks = async () => {
    setScanning(true)
    setError(null)
    setScanMessage(null)
    try {
      const response = await fetch('/api/books/scan', { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '扫描失败')
      setScanMessage(`扫描完成：${body.bookCount ?? 0} 本书，${body.chapterCount ?? 0} 章`)
      await loadBooks()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '扫描失败')
    } finally {
      setScanning(false)
    }
  }

  const createBook = async (idea: string) => {
    if (!idea) return
    setBookCreationLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'prompt', currentSkill: 'book-entry', idea }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || '开书请求失败')
      setBookEntrySessionId(body.session.id)
      setBookCreationOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '开书请求失败')
    } finally {
      setBookCreationLoading(false)
    }
  }

  const deleteBook = async (book: Book, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`确定删除《${book.title}》？书籍目录也会被删除，无法恢复。`)) return
    setError(null)
    try {
      const response = await fetch(`/api/books/${book.id}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 204) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || '删除失败')
      }
      await loadBooks()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败')
    }
  }

  const finishBookEntry = async () => {
    setBookEntrySessionId(null)
    await loadBooks()
  }

  return (
    <section>
      <header style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg }}>
        <div>
          <h1 style={{ margin: 0, fontSize: fontSize.xxl }}>书库</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>选择一本书进入单书工作台。</p>
        </div>
        <span style={{ flex: 1 }} />
        <button onClick={() => setBookCreationOpen(true)}>新建一本书</button>
        <button onClick={() => void scanBooks()} disabled={scanning}>{scanning ? '扫描中…' : '扫描 novels/'}</button>
      </header>

      {scanMessage && <div style={{ marginBottom: spacing.md, color: 'var(--green)' }}>{scanMessage}</div>}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, color: 'var(--red)' }}>
          <span>{error}</span>
          <button onClick={() => void loadBooks()}>重试</button>
        </div>
      )}
      {loading && <div style={{ color: 'var(--text-muted)' }}>正在加载书库…</div>}

      {!loading && !error && (
        <div style={{ display: 'grid', gap: spacing.md }}>
          {books.map((book) => (
            <div key={book.id} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <button onClick={() => onOpenBook(book.id)} style={{ flex: 1, textAlign: 'left', padding: spacing.lg, border: '1px solid var(--border)', borderRadius: radius.lg, background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                <strong>{book.title}</strong>
                <div style={{ color: 'var(--text-muted)', marginTop: spacing.xs }}>{book.root_path}</div>
              </button>
              <button onClick={(e) => void deleteBook(book, e)} title="删除此书" style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: radius.md, background: 'transparent', color: 'var(--red)', cursor: 'pointer', fontSize: fontSize.sm, flexShrink: 0 }}>删除</button>
            </div>
          ))}
          {books.length === 0 && <div style={{ color: 'var(--text-muted)' }}>暂无书籍，请扫描 novels/ 或新建一本书。</div>}
        </div>
      )}

      {bookEntrySessionId && (
        <div style={{ marginTop: spacing.lg }}>
          <ClaudeExecutionPanel sessionId={bookEntrySessionId} actionLabel="新建一本书" onDone={() => void finishBookEntry()} onInterrupted={() => void finishBookEntry()} onAnswerSubmitted={() => void loadBooks()} />
        </div>
      )}

      <BookCreationModal open={bookCreationOpen} onClose={() => setBookCreationOpen(false)} onSubmit={createBook} loading={bookCreationLoading} />
    </section>
  )
}
