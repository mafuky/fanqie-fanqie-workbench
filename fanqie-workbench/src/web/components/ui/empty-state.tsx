import { fontSize, spacing } from '../../styles/tokens.js'
import { Button } from './button.js'

type EmptyStateProps = {
  icon?: string
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon = '◎', title, description, action }: EmptyStateProps) {
  return (
    <div style={{ padding: `${spacing['4xl']}px ${spacing.xl}px`, textAlign: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: spacing.md, opacity: 0.3 }}>{icon}</div>
      <p style={{ color: 'var(--text-secondary)', fontSize: fontSize.lg - 1, fontWeight: 500 }}>
        {title}
      </p>
      {description && (
        <p style={{ color: 'var(--text-muted)', fontSize: fontSize.md, marginTop: spacing.xs }}>
          {description}
        </p>
      )}
      {action && (
        <div style={{ marginTop: spacing.lg }}>
          <Button variant="secondary" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  )
}
