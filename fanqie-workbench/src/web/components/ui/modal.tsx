import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { fontSize, fontWeight, radius, spacing } from '../../styles/tokens.js'
import { Button } from './button.js'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        animation: 'ui-fade-in 0.15s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: radius.lg,
          padding: spacing['2xl'],
          minWidth: 360,
          maxWidth: 480,
          animation: 'ui-scale-in 0.15s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          marginBottom: spacing.lg,
        }}>
          {title}
        </h3>
        <div style={{ marginBottom: spacing.xl }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

type ConfirmProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
}

export function Confirm({
  open, onClose, onConfirm,
  title, description,
  confirmLabel = '确认',
  danger = false,
  loading = false,
}: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: fontSize.lg - 1, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {description}
      </p>
    </Modal>
  )
}
