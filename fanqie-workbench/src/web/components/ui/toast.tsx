import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { fontSize, fontWeight, radius, spacing } from '../../styles/tokens.js'

type ToastType = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  type: ToastType
  message: string
}

type ToastApi = {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi>({
  success: () => {},
  error: () => {},
  info: () => {},
})

export const useToast = () => useContext(ToastContext)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const add = useCallback((type: ToastType, message: string) => {
    const id = ++nextId
    setToasts((prev) => [...prev, { id, type, message }])
  }, [])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const api = useMemo<ToastApi>(() => ({
    success: (msg) => add('success', msg),
    error: (msg) => add('error', msg),
    info: (msg) => add('info', msg),
  }), [add])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div style={{
        position: 'fixed',
        right: spacing.lg,
        bottom: spacing.lg,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.sm,
      }}>
        {toasts.map((toast) => (
          <ToastEntry key={toast.id} toast={toast} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const typeStyles: Record<ToastType, { color: string; icon: string }> = {
  success: { color: 'var(--green)', icon: '✓' },
  error: { color: 'var(--red)', icon: '✕' },
  info: { color: 'var(--accent)', icon: 'ℹ' },
}

function ToastEntry({ toast, onRemove }: { toast: ToastItem; onRemove: (id: number) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    timerRef.current = setTimeout(() => onRemove(toast.id), 3000)
    return () => clearTimeout(timerRef.current)
  }, [toast.id, onRemove])

  const ts = typeStyles[toast.type]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        padding: `${spacing.md}px ${spacing.lg}px`,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: radius.md,
        fontSize: fontSize.md,
        color: 'var(--text-primary)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        animation: 'ui-toast-in 0.2s ease',
        cursor: 'pointer',
        minWidth: 200,
      }}
      onClick={() => onRemove(toast.id)}
    >
      <span style={{ color: ts.color, fontWeight: fontWeight.bold }}>{ts.icon}</span>
      {toast.message}
    </div>
  )
}
