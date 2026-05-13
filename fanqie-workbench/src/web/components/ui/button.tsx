import type { CSSProperties, ReactNode, ButtonHTMLAttributes } from 'react'
import { fontSize, fontWeight, radius, spacing, transition } from '../../styles/tokens.js'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'>

const variantStyles: Record<ButtonVariant, { base: CSSProperties; hover: CSSProperties }> = {
  primary: {
    base: { background: 'var(--accent)', color: '#000', border: 'none' },
    hover: { background: 'var(--accent-hover)' },
  },
  secondary: {
    base: { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
    hover: { borderColor: 'var(--border-hover)' },
  },
  ghost: {
    base: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' },
    hover: { background: 'var(--bg-tertiary)' },
  },
  danger: {
    base: { background: 'var(--red-subtle)', color: 'var(--red)', border: 'none' },
    hover: { background: 'var(--red)', color: '#fff' },
  },
}

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: { padding: `${spacing.xs}px ${spacing.md}px`, fontSize: fontSize.xs },
  md: { padding: `${spacing.md - 3}px ${spacing.xl}px`, fontSize: fontSize.md },
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  icon,
  children,
  ...rest
}: ButtonProps) {
  const vs = variantStyles[variant]
  const isDisabled = disabled || loading

  return (
    <button
      {...rest}
      disabled={isDisabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: spacing.sm,
        borderRadius: radius.md,
        fontWeight: fontWeight.semibold,
        fontFamily: 'inherit',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.5 : 1,
        transition: `all ${transition.normal}`,
        whiteSpace: 'nowrap',
        ...sizeStyles[size],
        ...vs.base,
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) Object.assign(e.currentTarget.style, vs.hover)
      }}
      onMouseLeave={(e) => {
        if (!isDisabled) Object.assign(e.currentTarget.style, vs.base)
      }}
    >
      {loading && <ButtonSpinner size={14} />}
      {!loading && icon}
      {children}
    </button>
  )
}

function ButtonSpinner({ size }: { size: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'ui-spin 0.6s linear infinite',
      }}
    />
  )
}
