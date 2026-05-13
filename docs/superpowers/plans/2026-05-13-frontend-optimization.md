# Frontend Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the fanqie-workbench frontend with a self-built lightweight component library, rewrite all 3 pages using the new components, and implement the books management page with full functionality.

**Architecture:** Build a design token system + 10 UI components (`src/web/components/ui/`), then rewrite each page (`prompt-page`, `books-page`, `accounts-page`) to consume them. All components follow the existing CSS variable theming system (dark/light). No external UI dependencies.

**Tech Stack:** React 19, TypeScript, Vite 7, CSS variables (inline styles), SSE for live logs.

---

## File Structure (Final State)

```
src/web/
├── main.tsx                         (unchanged)
├── index.html                       (unchanged)
├── app.tsx                          (modify: add ToastProvider wrap)
├── styles/
│   └── tokens.ts                    (create: design constants)
├── components/
│   ├── ui/
│   │   ├── button.tsx               (create)
│   │   ├── card.tsx                 (create)
│   │   ├── input.tsx                (create)
│   │   ├── badge.tsx                (create)
│   │   ├── table.tsx                (create)
│   │   ├── empty-state.tsx          (create)
│   │   ├── toast.tsx                (create)
│   │   ├── modal.tsx                (create)
│   │   ├── spinner.tsx              (create)
│   │   └── page-header.tsx          (create)
│   ├── live-log-panel.tsx           (modify: use tokens, CSS variables)
│   ├── task-log-panel.tsx           (delete)
│   └── chapter-stage-badge.tsx      (delete)
└── pages/
    ├── prompt-page.tsx              (rewrite with new components)
    ├── books-page.tsx               (rewrite: full implementation)
    └── accounts-page.tsx            (rewrite with new components)
```

---

## Task 1: Design Token System

**Files:**
- Create: `src/web/styles/tokens.ts`

- [ ] **Step 1: Create the tokens file**

```ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
} as const

export const fontSize = {
  xs: 11,
  sm: 12,
  md: 13,
  lg: 15,
  xl: 18,
  '2xl': 22,
} as const

export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const

export const transition = {
  fast: '0.1s ease',
  normal: '0.15s ease',
  slow: '0.25s ease',
} as const
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors related to tokens.ts

- [ ] **Step 3: Commit**

```bash
git add src/web/styles/tokens.ts
git commit -m "feat(ui): add design token system"
```

---

## Task 2: Button Component

**Files:**
- Create: `src/web/components/ui/button.tsx`

- [ ] **Step 1: Create the Button component**

```tsx
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
      {loading && <Spinner size={14} />}
      {!loading && icon}
      {children}
    </button>
  )
}

function Spinner({ size }: { size: number }) {
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/button.tsx
git commit -m "feat(ui): add Button component"
```

---

## Task 3: Card Component

**Files:**
- Create: `src/web/components/ui/card.tsx`

- [ ] **Step 1: Create the Card component**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/card.tsx
git commit -m "feat(ui): add Card component"
```

---

## Task 4: Input and Textarea Components

**Files:**
- Create: `src/web/components/ui/input.tsx`

- [ ] **Step 1: Create the Input and Textarea components**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/input.tsx
git commit -m "feat(ui): add Input and Textarea components"
```

---

## Task 5: Badge Component

**Files:**
- Create: `src/web/components/ui/badge.tsx`

- [ ] **Step 1: Create the Badge component**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/badge.tsx
git commit -m "feat(ui): add Badge component"
```

---

## Task 6: EmptyState Component

**Files:**
- Create: `src/web/components/ui/empty-state.tsx`

- [ ] **Step 1: Create the EmptyState component**

```tsx
import type { ReactNode } from 'react'
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/empty-state.tsx
git commit -m "feat(ui): add EmptyState component"
```

---

## Task 7: Spinner Component

**Files:**
- Create: `src/web/components/ui/spinner.tsx`

- [ ] **Step 1: Create the Spinner component**

```tsx
type SpinnerSize = 'sm' | 'md' | 'lg'

const sizeMap: Record<SpinnerSize, number> = { sm: 16, md: 24, lg: 32 }

export function Spinner({ size = 'md' }: { size?: SpinnerSize }) {
  const px = sizeMap[size]
  return (
    <>
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
      <style>{`@keyframes ui-spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/spinner.tsx
git commit -m "feat(ui): add Spinner component"
```

---

## Task 8: PageHeader Component

**Files:**
- Create: `src/web/components/ui/page-header.tsx`

- [ ] **Step 1: Create the PageHeader component**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/page-header.tsx
git commit -m "feat(ui): add PageHeader component"
```

---

## Task 9: Table Component

**Files:**
- Create: `src/web/components/ui/table.tsx`

- [ ] **Step 1: Create the Table component**

```tsx
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
      {/* Header */}
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

      {/* Body */}
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/table.tsx
git commit -m "feat(ui): add Table component"
```

---

## Task 10: Toast System

**Files:**
- Create: `src/web/components/ui/toast.tsx`

- [ ] **Step 1: Create the Toast provider and hook**

```tsx
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { fontSize, fontWeight, radius, spacing, transition } from '../../styles/tokens.js'

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

  const api: ToastApi = {
    success: (msg) => add('success', msg),
    error: (msg) => add('error', msg),
    info: (msg) => add('info', msg),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div style={{
        position: 'fixed',
        top: spacing.lg,
        right: spacing.lg,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.sm,
      }}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const typeStyles: Record<ToastType, { bg: string; color: string; icon: string }> = {
  success: { bg: 'var(--green-subtle)', color: 'var(--green)', icon: '✓' },
  error: { bg: 'var(--red-subtle)', color: 'var(--red)', icon: '✕' },
  info: { bg: 'var(--accent-subtle)', color: 'var(--accent)', icon: 'ℹ' },
}

function ToastItem({ toast, onRemove }: { toast: ToastItem; onRemove: (id: number) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

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
      <style>{`@keyframes ui-toast-in { from { opacity:0; transform:translateX(20px) } to { opacity:1; transform:translateX(0) } }`}</style>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/toast.tsx
git commit -m "feat(ui): add Toast system with provider and hook"
```

---

## Task 11: Modal and Confirm Components

**Files:**
- Create: `src/web/components/ui/modal.tsx`

- [ ] **Step 1: Create the Modal and Confirm components**

```tsx
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { fontSize, fontWeight, radius, spacing, transition } from '../../styles/tokens.js'
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
      <style>{`
        @keyframes ui-fade-in { from { opacity:0 } to { opacity:1 } }
        @keyframes ui-scale-in { from { opacity:0; transform:scale(0.95) } to { opacity:1; transform:scale(1) } }
      `}</style>
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ui/modal.tsx
git commit -m "feat(ui): add Modal and Confirm components"
```

---

## Task 12: Add Global CSS Keyframes and Wrap App with ToastProvider

**Files:**
- Modify: `src/web/index.html` (add keyframes)
- Modify: `src/web/app.tsx` (add ToastProvider)

- [ ] **Step 1: Add global keyframes to index.html**

In `src/web/index.html`, inside the existing `<style>` block, before the closing `</style>`, add:

```css
    @keyframes ui-spin { to { transform: rotate(360deg); } }
    @keyframes ui-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    @keyframes ui-toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes ui-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ui-scale-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
```

- [ ] **Step 2: Add ToastProvider to app.tsx**

Add import at the top of `app.tsx`:

```tsx
import { ToastProvider } from './components/ui/toast.js'
```

Wrap the outermost `<div>` inside `ThemeContext.Provider` with `<ToastProvider>`:

```tsx
<ThemeContext.Provider value={{ theme, toggle }}>
  <ToastProvider>
    <div style={{ display: 'flex', minHeight: '100vh', ...vars, background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* ... sidebar + main ... */}
    </div>
  </ToastProvider>
</ThemeContext.Provider>
```

- [ ] **Step 3: Remove inline `<style>` tags from individual components**

Remove the `<style>` injection from Spinner (`src/web/components/ui/spinner.tsx`) — delete the `<style>` tag and `<>...</>` fragment wrapper, keeping just the `<span>`.

Similarly remove `<style>` from `toast.tsx` `ToastItem` and `modal.tsx` since keyframes are now global.

- [ ] **Step 4: Verify dev server starts**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/web/index.html src/web/app.tsx src/web/components/ui/spinner.tsx src/web/components/ui/toast.tsx src/web/components/ui/modal.tsx
git commit -m "feat(ui): add global keyframes, wrap App with ToastProvider"
```

---

## Task 13: Rewrite LiveLogPanel with Tokens

**Files:**
- Modify: `src/web/components/live-log-panel.tsx`

- [ ] **Step 1: Rewrite LiveLogPanel**

Replace the entire file content with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { fontSize, radius, spacing } from '../styles/tokens.js'

export function LiveLogPanel({ taskId, onDone }: { taskId: string; onDone?: (status: string) => void }) {
  const [lines, setLines] = useState<Array<{ stream: string; text: string }>>([])
  const [elapsed, setElapsed] = useState(0)
  const containerRef = useRef<HTMLPreElement>(null)
  const startRef = useRef(Date.now())

  useEffect(() => {
    setLines([])
    startRef.current = Date.now()
    setElapsed(0)

    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)

    const eventSource = new EventSource(`/api/tasks/${taskId}/stream`)

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setLines((prev) => [...prev, { stream: data.stream, text: data.chunk }])
    }

    eventSource.addEventListener('done', (event) => {
      const data = JSON.parse((event as MessageEvent).data)
      clearInterval(timer)
      onDone?.(data.status)
      eventSource.close()
    })

    eventSource.onerror = () => {
      clearInterval(timer)
      eventSource.close()
    }

    return () => {
      clearInterval(timer)
      eventSource.close()
    }
  }, [taskId, onDone])

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines])

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        marginBottom: spacing.md - 2,
      }}>
        <h3 style={{ fontSize: fontSize.md, fontWeight: 600, color: 'var(--text-secondary)' }}>
          执行日志
        </h3>
        <span style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--accent)',
          animation: 'ui-pulse 1.5s ease-in-out infinite',
        }} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>
          {elapsed}s
        </span>
      </div>
      <pre
        ref={containerRef}
        style={{
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          padding: spacing.xl,
          borderRadius: radius.lg,
          border: '1px solid var(--border)',
          fontSize: fontSize.md,
          fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
          lineHeight: 1.7,
          maxHeight: 520,
          minHeight: 200,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {lines.length === 0 && (
          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>等待输出...</span>
        )}
        {lines.map((line, i) => (
          <span key={i} style={{ color: line.stream === 'stderr' ? 'var(--red)' : 'var(--text-primary)' }}>
            {line.text}
          </span>
        ))}
      </pre>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/components/live-log-panel.tsx
git commit -m "refactor(ui): rewrite LiveLogPanel with tokens and elapsed timer"
```

---

## Task 14: Rewrite Prompt Page

**Files:**
- Modify: `src/web/pages/prompt-page.tsx`

- [ ] **Step 1: Rewrite prompt-page.tsx**

Replace the entire file with:

```tsx
import { useState, useCallback, useEffect } from 'react'
import { LiveLogPanel } from '../components/live-log-panel.js'
import { PageHeader } from '../components/ui/page-header.js'
import { Card } from '../components/ui/card.js'
import { Textarea } from '../components/ui/input.js'
import { Button } from '../components/ui/button.js'
import { Badge } from '../components/ui/badge.js'
import { useToast } from '../components/ui/toast.js'
import { spacing, fontSize, fontWeight, radius, transition } from '../styles/tokens.js'

type TaskRecord = {
  id: string
  type: string
  prompt: string
  status: string
  created_at: string
  finished_at: string | null
}

const SKILLS = [
  { id: 'custom', name: '自定义 Prompt', desc: '直接输入完整提示词' },
  { id: 'chinese-novelist', name: '章节写作', desc: '使用 chinese-novelist-skill 写章节' },
  { id: 'story-deslop', name: '去AI味', desc: '检测并清除AI写作痕迹' },
  { id: 'story-review', name: '多视角审稿', desc: '4个Agent并行审查找问题' },
  { id: 'story-long-write', name: '长篇写作', desc: '从大纲到正文辅助长篇创作' },
  { id: 'story-long-analyze', name: '长篇拆文', desc: '拆解爆款长篇的结构技巧' },
  { id: 'story-short-write', name: '短篇写作', desc: '短篇小说从构思到成稿' },
  { id: 'story-cover', name: '封面生成', desc: '自动生成网文封面' },
  { id: 'story-import', name: '导入小说', desc: '将已有小说导入标准目录结构' },
  { id: 'story', name: '工具箱入口', desc: '自动路由到对应skill' },
]

function buildPrompt(skillId: string, userInput: string): string {
  if (skillId === 'custom') return userInput
  return `使用 ${skillId} skill 执行以下任务：\n\n${userInput}`
}

const statusMap: Record<string, { variant: 'success' | 'error' | 'warning' | 'neutral'; label: string }> = {
  succeeded: { variant: 'success', label: '成功' },
  failed: { variant: 'error', label: '失败' },
  running: { variant: 'warning', label: '执行中' },
  queued: { variant: 'neutral', label: '排队中' },
}

export function PromptPage() {
  const [skill, setSkill] = useState('custom')
  const [prompt, setPrompt] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'succeeded' | 'failed'>('idle')
  const [history, setHistory] = useState<TaskRecord[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const toast = useToast()

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      setHistory(data.tasks || [])
    } catch {}
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || status === 'running') return
    setStatus('running')
    setTaskId(null)
    const fullPrompt = buildPrompt(skill, prompt.trim())
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: skill, prompt: fullPrompt }),
      })
      const data = await res.json()
      setTaskId(data.taskId)
    } catch {
      setStatus('failed')
      toast.error('任务提交失败')
    }
  }, [prompt, status, skill, toast])

  const handleDone = useCallback((finalStatus: string) => {
    const success = finalStatus === 'succeeded'
    setStatus(success ? 'succeeded' : 'failed')
    if (success) toast.success('任务执行成功')
    else toast.error('任务执行失败')
    loadHistory()
  }, [loadHistory, toast])

  const handleViewTask = useCallback((id: string) => {
    setTaskId(id)
    setStatus('idle')
  }, [])

  const handleClearHistory = useCallback(async () => {
    await fetch('/api/tasks', { method: 'DELETE' })
    setHistory([])
    setTaskId(null)
    toast.info('历史已清除')
  }, [toast])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) handleSubmit()
  }, [handleSubmit])

  const selectedSkill = SKILLS.find((s) => s.id === skill)

  return (
    <div>
      <PageHeader
        title="执行任务"
        description="选择 Skill 并输入指令，驱动 Claude 执行多轮写作任务"
      />

      {/* Skill selector */}
      <Card style={{ marginBottom: spacing.lg }}>
        <label style={{
          display: 'block', fontSize: fontSize.sm, fontWeight: fontWeight.semibold,
          color: 'var(--text-secondary)', textTransform: 'uppercase',
          letterSpacing: '0.05em', marginBottom: spacing.md - 2,
        }}>
          选择 Skill
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
          {SKILLS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSkill(s.id)}
              title={s.desc}
              style={{
                padding: `${spacing.sm - 2}px ${spacing.lg - 2}px`,
                background: skill === s.id ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                color: skill === s.id ? 'var(--accent)' : 'var(--text-secondary)',
                border: skill === s.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 20, cursor: 'pointer',
                fontSize: fontSize.sm, fontWeight: skill === s.id ? fontWeight.semibold : fontWeight.normal,
                fontFamily: 'inherit', transition: `all ${transition.fast}`,
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        {selectedSkill && selectedSkill.id !== 'custom' && (
          <p style={{ fontSize: fontSize.sm, color: 'var(--text-muted)', marginTop: spacing.sm }}>
            {selectedSkill.desc}
          </p>
        )}
      </Card>

      {/* Prompt input */}
      <Card style={{ marginBottom: spacing['2xl'] }}>
        <Textarea
          label={skill === 'custom' ? '提示词' : '任务指令'}
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={skill === 'custom'
            ? '输入完整提示词...'
            : `输入你要 ${selectedSkill?.name} 做什么，例如：为《雾港疑局》写第5章，悬疑节奏紧凑，不少于3000字`
          }
          rows={4}
        />
        <div style={{ marginTop: spacing.lg - 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
            <Button
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              loading={status === 'running'}
            >
              {status === 'running' ? '执行中...' : '▶ 执行'}
            </Button>
            {status === 'succeeded' && <Badge variant="success">✓ 成功</Badge>}
            {status === 'failed' && <Badge variant="error">✕ 失败</Badge>}
          </div>
          <span style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>⌘+Enter</span>
        </div>
      </Card>

      {/* Live log */}
      {taskId && (
        <div style={{ marginBottom: spacing['2xl'] }}>
          <LiveLogPanel taskId={taskId} onDone={handleDone} />
        </div>
      )}

      {/* Task history */}
      {history.length > 0 && (
        <div>
          <div
            onClick={() => setHistoryOpen((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', marginBottom: historyOpen ? spacing.md - 2 : 0, userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <span style={{
                fontSize: fontSize.sm, color: 'var(--text-muted)',
                transition: `transform ${transition.normal}`,
                transform: historyOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              }}>▶</span>
              <h3 style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: 'var(--text-secondary)' }}>
                历史任务 ({history.length})
              </h3>
            </div>
            {historyOpen && (
              <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); handleClearHistory() }}>
                清除全部
              </Button>
            )}
          </div>
          {historyOpen && (
            <Card padding={0} style={{ overflow: 'hidden' }}>
              {history.slice(0, 20).map((task) => {
                const sm = statusMap[task.status] || statusMap.queued
                return (
                  <div
                    key={task.id}
                    onClick={() => handleViewTask(task.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: `${spacing.md - 2}px ${spacing.lg}px`,
                      borderBottom: '1px solid var(--border)', cursor: 'pointer',
                      background: taskId === task.id ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: fontSize.md, color: 'var(--text-primary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 400,
                      }}>
                        {task.prompt}
                      </div>
                      <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)', marginTop: 2 }}>
                        {new Date(task.created_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <Badge variant={sm.variant}>{sm.label}</Badge>
                  </div>
                )
              })}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Start dev server and visually verify**

Run: `cd fanqie-workbench && npm run dev`

Open http://localhost:5173, verify:
- Skill selector pills render correctly
- Prompt textarea has label, focus border highlight
- Execute button uses Button component (orange, disabled state works)
- Toast appears on success/failure
- History section uses Card and Badge components
- Dark/light theme toggle works on all elements

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/prompt-page.tsx
git commit -m "refactor(ui): rewrite prompt page with component library"
```

---

## Task 15: Rewrite Accounts Page

**Files:**
- Modify: `src/web/pages/accounts-page.tsx`

- [ ] **Step 1: Rewrite accounts-page.tsx**

Replace the entire file with:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '../components/ui/page-header.js'
import { Card } from '../components/ui/card.js'
import { Input } from '../components/ui/input.js'
import { Button } from '../components/ui/button.js'
import { Badge } from '../components/ui/badge.js'
import { Table } from '../components/ui/table.js'
import { Confirm } from '../components/ui/modal.js'
import { Spinner } from '../components/ui/spinner.js'
import { useToast } from '../components/ui/toast.js'
import { spacing, fontSize } from '../styles/tokens.js'

type Account = {
  id: string
  label: string
  status: string
  lastCheckedAt: string | null
  createdAt: string
}

const statusBadge: Record<string, { variant: 'success' | 'error' | 'warning'; label: string }> = {
  active: { variant: 'success', label: '已登录' },
  expired: { variant: 'error', label: '已过期' },
  'needs-login': { variant: 'warning', label: '需登录' },
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)
  const toast = useToast()

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      setAccounts(data.accounts || [])
    } catch {
      toast.error('加载账号失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const handleAdd = useCallback(async () => {
    if (!newLabel.trim()) return
    setAdding(true)
    try {
      await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim() }),
      })
      setNewLabel('')
      toast.success('账号已添加')
      await loadAccounts()
    } catch {
      toast.error('添加失败')
    } finally {
      setAdding(false)
    }
  }, [newLabel, loadAccounts, toast])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await fetch(`/api/accounts/${deleteTarget.id}`, { method: 'DELETE' })
      toast.success('账号已删除')
      setDeleteTarget(null)
      await loadAccounts()
    } catch {
      toast.error('删除失败')
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadAccounts, toast])

  const handleSetActive = useCallback(async (id: string) => {
    try {
      await fetch(`/api/accounts/${id}/capture-session`, { method: 'POST' })
      toast.success('已激活')
      await loadAccounts()
    } catch {
      toast.error('激活失败')
    }
  }, [loadAccounts, toast])

  const columns = [
    {
      key: 'label',
      label: '标签',
      render: (row: Account) => <span style={{ fontWeight: 500 }}>{row.label}</span>,
    },
    {
      key: 'status',
      label: '状态',
      width: 100,
      render: (row: Account) => {
        const s = statusBadge[row.status] || statusBadge['needs-login']
        return <Badge variant={s.variant}>{s.label}</Badge>
      },
    },
    {
      key: 'createdAt',
      label: '创建时间',
      width: 160,
      render: (row: Account) => (
        <span style={{ color: 'var(--text-muted)', fontSize: fontSize.sm }}>
          {new Date(row.createdAt).toLocaleDateString('zh-CN')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '操作',
      width: 140,
      render: (row: Account) => (
        <div style={{ display: 'flex', gap: spacing.sm - 2 }}>
          {row.status === 'needs-login' && (
            <Button variant="secondary" size="sm" onClick={() => handleSetActive(row.id)}>
              激活
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={() => setDeleteTarget(row)}>
            删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="账号管理" description="管理番茄小说发布账号与登录态" />

      {/* Add account */}
      <Card style={{ marginBottom: spacing.xl, display: 'flex', gap: spacing.md - 2, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="输入账号标签，如：主号、小号A..."
          />
        </div>
        <Button onClick={handleAdd} disabled={!newLabel.trim()} loading={adding}>
          + 添加账号
        </Button>
      </Card>

      {/* Account list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: spacing['4xl'] }}>
          <Spinner size="lg" />
        </div>
      ) : (
        <Table
          columns={columns}
          data={accounts}
          rowKey={(row) => row.id}
          emptyTitle="暂无账号"
          emptyIcon="◎"
        />
      )}

      {/* Delete confirmation */}
      <Confirm
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="删除账号"
        description={`确定要删除账号「${deleteTarget?.label || ''}」吗？此操作不可撤销。`}
        confirmLabel="删除"
        danger
        loading={deleting}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Visually verify in browser**

Open http://localhost:5173, navigate to 账号管理:
- Add account input + button renders correctly
- Table shows accounts with Badge status
- Delete button opens Confirm dialog
- Toast fires on add/delete/activate
- Loading spinner shows on initial load
- Empty state shows when no accounts
- Dark/light theme works

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/accounts-page.tsx
git commit -m "refactor(ui): rewrite accounts page with component library"
```

---

## Task 16: Rewrite Books Page (Full Implementation)

**Files:**
- Modify: `src/web/pages/books-page.tsx`

- [ ] **Step 1: Rewrite books-page.tsx**

Replace the entire file with:

```tsx
import { useState, useEffect, useCallback } from 'react'
import type { ChapterStage } from '../../domain/chapter.js'
import { PageHeader } from '../components/ui/page-header.js'
import { Card } from '../components/ui/card.js'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { EmptyState } from '../components/ui/empty-state.js'
import { Spinner } from '../components/ui/spinner.js'
import { useToast } from '../components/ui/toast.js'
import { spacing, fontSize, fontWeight, radius, transition } from '../styles/tokens.js'

type BookWithChapters = {
  id: string
  title: string
  root_path: string
  account_id: string | null
  chapters: ChapterRow[]
}

type ChapterRow = {
  id: string
  chapter_number: number
  title: string
  stage: ChapterStage
}

const ALL_STAGES: ChapterStage[] = ['待写作', '已初稿', '已去AI', '已审稿', '可发布', '发布中', '已发布']

const stageBadgeVariant: Record<ChapterStage, 'neutral' | 'info' | 'warning' | 'success' | 'error'> = {
  '待写作': 'neutral',
  '已初稿': 'info',
  '已去AI': 'warning',
  '已审稿': 'info',
  '可发布': 'success',
  '发布中': 'error',
  '已发布': 'success',
}

export function BooksPage() {
  const [books, setBooks] = useState<BookWithChapters[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<ChapterStage | 'all'>('all')
  const toast = useToast()

  const loadBooks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/books')
      const data = await res.json()
      const booksRaw: Array<{ id: string; title: string; root_path: string; account_id: string | null }> = data.books || []

      const booksWithChapters = await Promise.all(
        booksRaw.map(async (book) => {
          const chRes = await fetch(`/api/books/${book.id}`)
          const chData = await chRes.json()
          return { ...book, chapters: (chData.chapters || []) as ChapterRow[] }
        })
      )
      setBooks(booksWithChapters)
    } catch {
      toast.error('加载书籍失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadBooks() }, [loadBooks])

  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/books/scan', { method: 'POST' })
      const data = await res.json()
      toast.success(`扫描完成：${data.bookCount} 本书，${data.chapterCount} 章`)
      await loadBooks()
    } catch {
      toast.error('扫描失败')
    } finally {
      setScanning(false)
    }
  }, [loadBooks, toast])

  const toggleBook = useCallback((bookId: string) => {
    setExpandedBookId((prev) => prev === bookId ? null : bookId)
    setStageFilter('all')
  }, [])

  const totalChapters = books.reduce((sum, b) => sum + b.chapters.length, 0)
  const publishedChapters = books.reduce((sum, b) => sum + b.chapters.filter((c) => c.stage === '已发布').length, 0)
  const pendingChapters = totalChapters - publishedChapters

  const stats = [
    { label: '总书籍', value: books.length, color: 'var(--text-primary)' },
    { label: '总章节', value: totalChapters, color: 'var(--text-primary)' },
    { label: '已发布', value: publishedChapters, color: 'var(--green)' },
    { label: '待处理', value: pendingChapters, color: 'var(--accent)' },
  ]

  if (loading) {
    return (
      <div>
        <PageHeader title="书籍管理" description="管理工作区内的小说项目" />
        <div style={{ display: 'flex', justifyContent: 'center', padding: spacing['4xl'] }}>
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="书籍管理"
        description="管理工作区内的小说项目"
        actions={
          <>
            <Button variant="secondary" onClick={loadBooks}>刷新</Button>
            <Button onClick={handleScan} loading={scanning}>扫描 novels/ 目录</Button>
          </>
        }
      />

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: spacing.lg, marginBottom: spacing.xl }}>
        {stats.map((s) => (
          <div key={s.label} style={{
            padding: `${spacing.sm}px ${spacing.lg}px`,
            background: 'var(--bg-secondary)',
            borderRadius: radius.md,
            fontSize: fontSize.sm,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
            <span style={{ color: s.color, fontWeight: fontWeight.semibold, marginLeft: spacing.sm - 2 }}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Book list */}
      {books.length === 0 ? (
        <Card>
          <EmptyState
            icon="◉"
            title="暂无书籍"
            description="点击「扫描 novels/ 目录」导入工作区中的小说"
            action={{ label: '扫描 novels/ 目录', onClick: handleScan }}
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {books.map((book) => {
            const expanded = expandedBookId === book.id
            const bookPublished = book.chapters.filter((c) => c.stage === '已发布').length
            const bookPending = book.chapters.length - bookPublished
            const filteredChapters = stageFilter === 'all'
              ? book.chapters
              : book.chapters.filter((c) => c.stage === stageFilter)

            const stageCounts = ALL_STAGES.map((stage) => ({
              stage,
              count: book.chapters.filter((c) => c.stage === stage).length,
            }))

            return (
              <Card key={book.id} padding={0}>
                {/* Book header — clickable */}
                <div
                  onClick={() => toggleBook(book.id)}
                  style={{
                    padding: `${spacing.lg}px ${spacing.xl}px`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
                    <span style={{
                      color: expanded ? 'var(--accent)' : 'var(--text-muted)',
                      fontSize: fontSize.lg + 1,
                      transition: `transform ${transition.normal}`,
                      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      display: 'inline-block',
                    }}>▸</span>
                    <div>
                      <div style={{ fontWeight: fontWeight.semibold, fontSize: fontSize.lg - 1 }}>
                        {book.title}
                      </div>
                      <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)', marginTop: 2 }}>
                        {book.root_path} · {book.chapters.length} 章 · 已发布 {bookPublished}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: spacing.sm - 2 }}>
                    {bookPublished > 0 && <Badge variant="success">{bookPublished} 已发布</Badge>}
                    {bookPending > 0 && <Badge variant="warning">{bookPending} 待处理</Badge>}
                  </div>
                </div>

                {/* Expanded chapter list */}
                {expanded && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {/* Stage filter tabs */}
                    <div style={{
                      display: 'flex',
                      padding: `${spacing.md}px ${spacing.xl}px`,
                      gap: spacing.sm,
                      borderBottom: '1px solid var(--border)',
                      overflowX: 'auto',
                    }}>
                      <FilterTab
                        active={stageFilter === 'all'}
                        onClick={() => setStageFilter('all')}
                        label={`全部 (${book.chapters.length})`}
                      />
                      {stageCounts.map(({ stage, count }) => (
                        <FilterTab
                          key={stage}
                          active={stageFilter === stage}
                          onClick={() => setStageFilter(stage)}
                          label={`${stage} (${count})`}
                        />
                      ))}
                    </div>

                    {/* Chapter rows */}
                    {filteredChapters.length === 0 ? (
                      <div style={{ padding: `${spacing['2xl']}px ${spacing.xl}px`, textAlign: 'center' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: fontSize.md }}>
                          该筛选条件下暂无章节
                        </p>
                      </div>
                    ) : (
                      filteredChapters.map((ch) => (
                        <div
                          key={ch.id}
                          style={{
                            padding: `${spacing.sm}px ${spacing.xl}px ${spacing.sm}px ${spacing['4xl'] + spacing.xs}px`,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            borderBottom: '1px solid var(--border)',
                            fontSize: fontSize.md,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md - 2 }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: fontSize.xs, width: 24 }}>
                              {String(ch.chapter_number).padStart(2, '0')}
                            </span>
                            <span>{ch.title}</span>
                          </div>
                          <Badge variant={stageBadgeVariant[ch.stage]}>{ch.stage}</Badge>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: `${spacing.xs}px ${spacing.md - 2}px`,
        background: active ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        border: 'none',
        borderRadius: radius.sm,
        fontSize: fontSize.xs,
        fontWeight: active ? fontWeight.medium : fontWeight.normal,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: `all ${transition.fast}`,
      }}
    >
      {label}
    </button>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Visually verify in browser**

Open http://localhost:5173, navigate to 书籍管理:
- PageHeader shows with scan + refresh buttons
- Stats bar shows counts (may be all zeros if no data)
- Empty state shows with "扫描 novels/ 目录" action button
- Click scan, verify toast shows result
- If books exist: cards render, click to expand, chapter list shows
- Stage filter tabs work
- Badge colors match each stage
- Dark/light theme works

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/books-page.tsx
git commit -m "feat(ui): rewrite books page with full chapter management"
```

---

## Task 17: Delete Old Components and Final Cleanup

**Files:**
- Delete: `src/web/components/task-log-panel.tsx`
- Delete: `src/web/components/chapter-stage-badge.tsx`

- [ ] **Step 1: Delete old components**

```bash
rm src/web/components/task-log-panel.tsx
rm src/web/components/chapter-stage-badge.tsx
```

- [ ] **Step 2: Search for any remaining imports of deleted files**

Run: `cd fanqie-workbench && grep -r "task-log-panel\|chapter-stage-badge" src/web/`
Expected: No output (no remaining imports)

- [ ] **Step 3: Verify full project compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run existing tests to check for regressions**

Run: `cd fanqie-workbench && npm test`
Expected: All tests pass (tests are backend-only, should not be affected)

- [ ] **Step 5: Full visual smoke test**

Open http://localhost:5173 and verify all 3 pages:
1. **执行任务**: skill selector, prompt input, execute, log panel, history
2. **书籍管理**: scan, book cards, expand/collapse, stage filter, chapter list
3. **账号管理**: add account, table, activate, delete with confirm dialog

For each page, toggle dark/light theme and verify all elements follow the theme.

- [ ] **Step 6: Commit**

```bash
git add -A src/web/components/task-log-panel.tsx src/web/components/chapter-stage-badge.tsx
git commit -m "chore: remove deprecated TaskLogPanel and ChapterStageBadge components"
```
