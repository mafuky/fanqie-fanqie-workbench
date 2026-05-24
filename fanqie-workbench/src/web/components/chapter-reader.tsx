import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Spinner } from './ui/spinner.js'
import { Badge } from './ui/badge.js'
import { spacing, fontSize, fontWeight, radius, transition } from '../styles/tokens.js'

type ChapterPayload = {
  id: string
  chapterNumber: number
  title: string
  stage: string
  bookId: string
  bookTitle: string
  content: string
  wordCount: number
  sourcePath: string
  prevChapterId: string | null
  nextChapterId: string | null
}

type Props = {
  chapterId: string
  onClose: () => void
  onNavigate: (chapterId: string) => void
}

export function ChapterReader({ chapterId, onClose, onNavigate }: Props) {
  const [data, setData] = useState<ChapterPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/chapters/${chapterId}/content`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        return res.json()
      })
      .then((payload) => {
        if (!cancelled) {
          setData(payload as ChapterPayload)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [chapterId])

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      } else if (event.key === 'ArrowLeft' && data?.prevChapterId) {
        onNavigate(data.prevChapterId)
      } else if (event.key === 'ArrowRight' && data?.nextChapterId) {
        onNavigate(data.nextChapterId)
      }
    },
    [data, onClose, onNavigate],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [])

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'stretch',
        animation: 'ui-fade-in 0.15s ease',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 880,
          margin: '32px auto',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: radius.lg,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        <header
          style={{
            padding: `${spacing.lg}px ${spacing['2xl']}px`,
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
              {data?.bookTitle ?? '...'}
            </div>
            <div
              style={{
                fontSize: fontSize.xl,
                fontWeight: fontWeight.bold,
                color: 'var(--text-primary)',
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {data ? `第 ${data.chapterNumber} 章 · ${data.title}` : '加载中…'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            {data && <Badge>{data.stage}</Badge>}
            {data && (
              <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>
                {data.wordCount.toLocaleString()} 字
              </span>
            )}
            <button
              onClick={onClose}
              aria-label="关闭阅读器"
              style={{
                width: 32,
                height: 32,
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: radius.sm,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                transition: `background ${transition.normal}`,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              ×
            </button>
          </div>
        </header>

        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: `${spacing['3xl']}px ${spacing['4xl']}px`,
            background: 'var(--bg-primary)',
          }}
        >
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: spacing['4xl'] }}>
              <Spinner />
            </div>
          )}
          {error && (
            <div
              style={{
                color: 'var(--red)',
                padding: spacing.lg,
                background: 'var(--red-subtle)',
                borderRadius: radius.sm,
              }}
            >
              加载失败：{error}
            </div>
          )}
          {data && (
            <article
              className="chapter-prose"
              style={{
                color: 'var(--text-primary)',
                fontSize: 16,
                lineHeight: 1.85,
                fontFamily: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", Georgia, serif',
                letterSpacing: '0.02em',
              }}
            >
              <ReactMarkdown>{data.content}</ReactMarkdown>
            </article>
          )}
        </main>

        <footer
          style={{
            padding: `${spacing.md}px ${spacing['2xl']}px`,
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => data?.prevChapterId && onNavigate(data.prevChapterId)}
            disabled={!data?.prevChapterId}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: radius.sm,
              color: data?.prevChapterId ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: data?.prevChapterId ? 'pointer' : 'not-allowed',
              fontSize: fontSize.sm,
              opacity: data?.prevChapterId ? 1 : 0.5,
              transition: `all ${transition.normal}`,
              fontFamily: 'inherit',
            }}
          >
            ← 上一章
          </button>
          <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>Esc 关闭 · ← → 翻章</span>
          <button
            onClick={() => data?.nextChapterId && onNavigate(data.nextChapterId)}
            disabled={!data?.nextChapterId}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: radius.sm,
              color: data?.nextChapterId ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: data?.nextChapterId ? 'pointer' : 'not-allowed',
              fontSize: fontSize.sm,
              opacity: data?.nextChapterId ? 1 : 0.5,
              transition: `all ${transition.normal}`,
              fontFamily: 'inherit',
            }}
          >
            下一章 →
          </button>
        </footer>
      </div>
    </div>
  )
}
