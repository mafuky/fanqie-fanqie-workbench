import type { ReactNode } from 'react'
import { fontSize, fontWeight, spacing } from '../../styles/tokens.js'

type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div style={{
      marginBottom: spacing['3xl'] - 4,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    }}>
      <div>
        <h2 style={{ fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, letterSpacing: '-0.02em' }}>
          {title}
        </h2>
        {description && (
          <p style={{ fontSize: fontSize.md, color: 'var(--text-muted)', marginTop: spacing.xs }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: spacing.sm }}>{actions}</div>}
    </div>
  )
}
