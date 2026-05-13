import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { fontSize, fontWeight, radius, spacing, transition } from '../../styles/tokens.js'

type InputProps = {
  label?: string
  error?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'style'>

type TextareaProps = {
  label?: string
  error?: string
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'>

const labelStyle = {
  display: 'block' as const,
  fontSize: fontSize.sm,
  fontWeight: fontWeight.semibold,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: spacing.sm,
}

function inputBaseStyle(hasError: boolean) {
  return {
    width: '100%',
    padding: `${spacing.md}px ${spacing.lg - 2}px`,
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: `1px solid ${hasError ? 'var(--red)' : 'var(--border)'}`,
    borderRadius: radius.md,
    fontSize: fontSize.lg - 1,
    fontFamily: 'inherit',
    lineHeight: 1.6,
    outline: 'none',
    transition: `border-color ${transition.normal}`,
  }
}

function handleFocus(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = 'var(--accent)'
}

function handleBlur(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>, hasError: boolean) {
  e.currentTarget.style.borderColor = hasError ? 'var(--red)' : 'var(--border)'
}

export function Input({ label, error, ...rest }: InputProps) {
  const hasError = !!error
  return (
    <div>
      {label && <label style={labelStyle}>{label}</label>}
      <input
        {...rest}
        style={inputBaseStyle(hasError)}
        onFocus={handleFocus}
        onBlur={(e) => handleBlur(e, hasError)}
      />
      {error && (
        <p style={{ fontSize: fontSize.xs, color: 'var(--red)', marginTop: spacing.xs }}>{error}</p>
      )}
    </div>
  )
}

export function Textarea({ label, error, ...rest }: TextareaProps) {
  const hasError = !!error
  return (
    <div>
      {label && <label style={labelStyle}>{label}</label>}
      <textarea
        {...rest}
        style={{ ...inputBaseStyle(hasError), resize: 'vertical' as const }}
        onFocus={handleFocus}
        onBlur={(e) => handleBlur(e, hasError)}
      />
      {error && (
        <p style={{ fontSize: fontSize.xs, color: 'var(--red)', marginTop: spacing.xs }}>{error}</p>
      )}
    </div>
  )
}
