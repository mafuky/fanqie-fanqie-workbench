import type { ReactNode } from 'react'
import { fontSize, fontWeight, radius, spacing } from '../../styles/tokens.js'

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

type BadgeProps = {
  variant?: BadgeVariant
  children: ReactNode
}

const variantStyles: Record<BadgeVariant, { background: string; color: string }> = {
  success: { background: 'var(--green-subtle)', color: 'var(--green)' },
  warning: { background: 'var(--accent-subtle)', color: 'var(--accent)' },
  error: { background: 'var(--red-subtle)', color: 'var(--red)' },
  info: { background: 'rgba(59,130,246,0.1)', color: '#3b82f6' },
  neutral: { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' },
}

export function Badge({ variant = 'neutral', children }: BadgeProps) {
  const vs = variantStyles[variant]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: `3px ${spacing.md - 2}px`,
        borderRadius: radius.sm,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        ...vs,
      }}
    >
      {children}
    </span>
  )
}
