import type { CSSProperties, ReactNode } from 'react'
import { radius, spacing } from '../../styles/tokens.js'

type CardProps = {
  children: ReactNode
  padding?: number
  style?: CSSProperties
}

export function Card({ children, padding = spacing.xl, style }: CardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: radius.lg,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
