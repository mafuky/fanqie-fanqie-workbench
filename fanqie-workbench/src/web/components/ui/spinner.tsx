type SpinnerSize = 'sm' | 'md' | 'lg'

const sizeMap: Record<SpinnerSize, number> = { sm: 16, md: 24, lg: 32 }

export function Spinner({ size = 'md' }: { size?: SpinnerSize }) {
  const px = sizeMap[size]
  return (
    <span
      style={{
        display: 'inline-block',
        width: px,
        height: px,
        border: '2px solid var(--border)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'ui-spin 0.6s linear infinite',
      }}
    />
  )
}
