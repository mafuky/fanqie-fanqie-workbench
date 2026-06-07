import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Spinner } from './ui/spinner.js'
import { spacing, fontSize, fontWeight, radius, transition } from '../styles/tokens.js'

type Props = {
  scanId: string
  onClose: () => void
}

type ScanContent = { fileName: string; content: string }

export function MarketScanModal({ scanId, onClose }: Props) {
  const [data, setData] = useState<ScanContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/market-scans/${encodeURIComponent(scanId)}/content`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        return res.json()
      })
      .then((payload) => {
        if (!cancelled) {
          setData(payload as ScanContent)
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
  }, [scanId])

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    },
    [onClose],
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
        role="dialog"
        aria-modal="true"
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
          <div
            style={{
              fontSize: fontSize.xl,
              fontWeight: fontWeight.bold,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {data?.fileName ?? '加载中…'}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭报告"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
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
          >
            ×
          </button>
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
            <article className="chapter-prose" style={{ color: 'var(--text-primary)', fontSize: fontSize.lg, lineHeight: 1.8 }}>
              <ReactMarkdown>{data.content}</ReactMarkdown>
            </article>
          )}
        </main>
      </div>
    </div>
  )
}
