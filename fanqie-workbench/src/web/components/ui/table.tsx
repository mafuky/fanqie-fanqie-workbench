import type { ReactNode } from 'react'
import { fontSize, fontWeight, spacing } from '../../styles/tokens.js'
import { EmptyState } from './empty-state.js'

type Column<T> = {
  key: string
  label: string
  width?: string | number
  render?: (row: T) => ReactNode
}

type TableProps<T> = {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T) => string
  emptyTitle?: string
  emptyIcon?: string
}

export function Table<T>({ columns, data, rowKey, emptyTitle = '暂无数据', emptyIcon }: TableProps<T>) {
  const gridTemplate = columns.map((c) => c.width ? (typeof c.width === 'number' ? `${c.width}px` : c.width) : '1fr').join(' ')

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: gridTemplate,
        padding: `${spacing.md - 2}px ${spacing.xl}px`,
        borderBottom: '1px solid var(--border)',
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {columns.map((col) => (
          <span key={col.key}>{col.label}</span>
        ))}
      </div>

      {data.length === 0 ? (
        <EmptyState icon={emptyIcon} title={emptyTitle} />
      ) : (
        data.map((row) => (
          <div
            key={rowKey(row)}
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              padding: `${spacing.md}px ${spacing.xl}px`,
              borderBottom: '1px solid var(--border)',
              alignItems: 'center',
              fontSize: fontSize.md,
            }}
          >
            {columns.map((col) => (
              <span key={col.key}>
                {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
              </span>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
