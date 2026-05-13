# Chapter Area Warm Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the books page chapter area into a warm paper / chapter-note visual style without changing any interaction logic, API behavior, or global theme system.

**Architecture:** Keep all existing data flow, event handlers, and component structure in `src/web/pages/books-page.tsx`. Only replace the chapter-row visual treatment: row layout, chapter number chip, title text styling, warm badge palette, hover state, and the active processing row highlight. Reuse existing `Badge`, `Button`, `Input`, and token constants instead of introducing new components.

**Tech Stack:** React 19, TypeScript, inline styles, existing component library (`Badge`, `Button`, `Input`), existing token constants (`spacing`, `fontSize`, `fontWeight`, `radius`, `transition`).

---

## File Structure

```
fanqie-workbench/src/web/pages/books-page.tsx
  - keep logic unchanged
  - modify only chapter-area rendering under the expanded book section
  - update stage badge color mapping to warm palette
  - update chapter row layout and styling
  - update processing / waiting / ready visual states
```

No new files are needed.

---

### Task 1: Warm Stage Palette

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx:31-39`

- [ ] **Step 1: Replace the current `stageBadgeVariant` with a warm palette mapping constant pair**

Replace the current stage mapping block with this exact code:

```tsx
const stageBadgeVariant: Record<ChapterStage, 'neutral' | 'warning' | 'success' | 'error'> = {
  '待写作': 'neutral',
  '已初稿': 'warning',
  '已去AI': 'warning',
  '已审稿': 'neutral',
  '可发布': 'success',
  '发布中': 'error',
  '已发布': 'success',
}

const stageBadgeStyle: Record<ChapterStage, React.CSSProperties> = {
  '待写作': {
    background: '#efe4d3',
    color: '#7b6248',
    border: '1px solid #e2d0b8',
  },
  '已初稿': {
    background: '#f6ead7',
    color: '#946535',
    border: '1px solid #ebd2ad',
  },
  '已去AI': {
    background: '#f3dfc4',
    color: '#9a5b25',
    border: '1px solid #e8c79e',
  },
  '已审稿': {
    background: '#f1e7da',
    color: '#7e6652',
    border: '1px solid #e5d5c3',
  },
  '可发布': {
    background: '#e8efe1',
    color: '#5f7750',
    border: '1px solid #d3dfc7',
  },
  '发布中': {
    background: '#f4ddd7',
    color: '#965547',
    border: '1px solid #e7beb3',
  },
  '已发布': {
    background: '#e7efe3',
    color: '#557448',
    border: '1px solid #cfe0c6',
  },
}
```

- [ ] **Step 2: Add the missing `React` type import for `React.CSSProperties`**

At the top of `fanqie-workbench/src/web/pages/books-page.tsx`, change the first import from:

```tsx
import { useState, useEffect, useCallback } from 'react'
```

to:

```tsx
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
```

- [ ] **Step 3: Run TypeScript to verify the new mapping compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/books-page.tsx
git commit -m "refactor(ui): add warm badge palette for chapter stages"
```

---

### Task 2: Chapter Number Tag + Warm Card Layout

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx:327-366`

- [ ] **Step 1: Replace the current chapter row JSX block with a warm card-style layout**

Inside the `filteredChapters.map((ch) => { ... return (...) })` block, replace the current returned `<div key={ch.id} className="chapter-row" ...>` section with this exact JSX:

```tsx
<div
  key={ch.id}
  className="chapter-row"
  style={{
    margin: `${spacing.sm}px ${spacing.xl}px`,
    padding: `${spacing.md}px ${spacing.lg}px`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    border: isProcessing ? '1px solid #e7c497' : '1px solid #eadfcf',
    borderRadius: 14,
    fontSize: fontSize.md,
    background: isProcessing
      ? 'linear-gradient(180deg, #fffaf2, #f6eadb)'
      : 'linear-gradient(180deg, #fffdf8, #f8f0e5)',
    boxShadow: isProcessing
      ? '0 8px 24px rgba(161, 111, 43, 0.10)'
      : '0 4px 14px rgba(120, 80, 30, 0.06)',
    transition: `all ${transition.normal}`,
  }}
>
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.md }}>
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 10px',
        borderRadius: 999,
        background: isProcessing ? '#f0ddc3' : '#f4e6d2',
        color: isProcessing ? '#9a5b25' : '#9a6a2e',
        fontSize: fontSize.xs,
        fontWeight: fontWeight.bold,
        whiteSpace: 'nowrap',
        marginTop: 1,
      }}
    >
      第{ch.chapter_number}章
    </span>
    <div>
      <div style={{
        fontSize: fontSize.md + 1,
        fontWeight: fontWeight.semibold,
        color: '#4b3b2f',
        lineHeight: 1.4,
      }}>
        {ch.title}
      </div>
      <div style={{
        fontSize: fontSize.xs,
        color: '#8b7461',
        marginTop: 4,
        lineHeight: 1.5,
      }}>
        {isProcessing
          ? '正在处理这一章，像被摊开的稿纸'
          : isReady
            ? '当前章节已进入可发布状态'
            : '继续推进这一章的写作流程'}
      </div>
    </div>
  </div>
  <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.medium,
        ...stageBadgeStyle[ch.stage],
      }}
    >
      {ch.stage}
    </span>
    {isReady ? (
      <span style={{ fontSize: fontSize.xs, color: '#6e8b5e', fontWeight: fontWeight.semibold }}>✓</span>
    ) : isProcessing ? (
      <span style={{ fontSize: fontSize.xs, color: '#9a5b25', fontWeight: fontWeight.semibold }}>处理中...</span>
    ) : isOtherProcessing ? (
      <span style={{ fontSize: fontSize.xs, color: '#a28d78' }}>等待</span>
    ) : (
      <Button
        variant="primary"
        size="sm"
        onClick={() => handleProcess(ch.id)}
      >
        处理
      </Button>
    )}
  </div>
</div>
```

- [ ] **Step 2: Remove the old row-level `borderBottom`-driven table feel**

Delete the old row styling fields that no longer apply:
- `padding: `${spacing.sm}px ${spacing.xl}px ${spacing.sm}px ${spacing['4xl'] + spacing.xs}px``
- `borderBottom: '1px solid var(--border)'`
- `background: isProcessing ? 'var(--accent-subtle)' : 'transparent'`

These are already removed by the full replacement above; just verify they are gone.

- [ ] **Step 3: Run TypeScript to verify JSX still compiles**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/books-page.tsx
git commit -m "refactor(ui): restyle chapter rows as warm paper cards"
```

---

### Task 3: Warm Hover + Waiting-State Softening

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx:328-365`

- [ ] **Step 1: Make the row hover feel softer and paper-like**

Inside the warm card row JSX from Task 2, add these two style keys to the outermost chapter row style object:

```tsx
cursor: 'default',
transform: isProcessing ? 'translateY(-1px)' : 'none',
```

So the outer chapter row style object becomes:

```tsx
style={{
  margin: `${spacing.sm}px ${spacing.xl}px`,
  padding: `${spacing.md}px ${spacing.lg}px`,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  border: isProcessing ? '1px solid #e7c497' : '1px solid #eadfcf',
  borderRadius: 14,
  fontSize: fontSize.md,
  background: isProcessing
    ? 'linear-gradient(180deg, #fffaf2, #f6eadb)'
    : 'linear-gradient(180deg, #fffdf8, #f8f0e5)',
  boxShadow: isProcessing
    ? '0 8px 24px rgba(161, 111, 43, 0.10)'
    : '0 4px 14px rgba(120, 80, 30, 0.06)',
  transition: `all ${transition.normal}`,
  cursor: 'default',
  transform: isProcessing ? 'translateY(-1px)' : 'none',
}}
```

- [ ] **Step 2: Make the “等待” state less cold and less noisy**

Inside the action area, replace this branch:

```tsx
<span style={{ fontSize: fontSize.xs, color: '#a28d78' }}>等待</span>
```

with:

```tsx
<span style={{
  fontSize: fontSize.xs,
  color: '#a28d78',
  background: '#f3ebdf',
  border: '1px solid #e7d9c7',
  padding: '4px 10px',
  borderRadius: 999,
}}
>
  等待
</span>
```

- [ ] **Step 3: Run TypeScript to verify no regressions**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/books-page.tsx
git commit -m "refactor(ui): soften waiting state and processing emphasis"
```

---

### Task 4: Warm Empty-State and Section Rhythm

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx:315-320`
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx:281-312`

- [ ] **Step 1: Warm up the empty-state text inside filtered chapters**

Replace:

```tsx
<div style={{ padding: `${spacing['2xl']}px ${spacing.xl}px`, textAlign: 'center' }}>
  <p style={{ color: 'var(--text-muted)', fontSize: fontSize.md }}>
    该筛选条件下暂无章节
  </p>
</div>
```

with:

```tsx
<div style={{
  margin: `${spacing.sm}px ${spacing.xl}px ${spacing.lg}px`,
  padding: `${spacing['2xl']}px ${spacing.xl}px`,
  textAlign: 'center',
  background: 'linear-gradient(180deg, #fffdf8, #f7efe4)',
  border: '1px dashed #e8d9c6',
  borderRadius: 14,
}}>
  <p style={{ color: '#8b7461', fontSize: fontSize.md }}>
    该筛选条件下暂无章节
  </p>
</div>
```

- [ ] **Step 2: Loosen the rhythm between filter tabs and rows**

In the expanded content section, change the filter tab container padding from:

```tsx
padding: `${spacing.md}px ${spacing.xl}px`,
```

to:

```tsx
padding: `${spacing.lg - 2}px ${spacing.xl}px ${spacing.md}px`,
```

and add:

```tsx
background: 'linear-gradient(180deg, rgba(255,253,248,0.06), transparent)',
```

So the filter tab container style becomes:

```tsx
style={{
  display: 'flex',
  padding: `${spacing.lg - 2}px ${spacing.xl}px ${spacing.md}px`,
  gap: spacing.sm,
  borderBottom: '1px solid var(--border)',
  overflowX: 'auto',
  background: 'linear-gradient(180deg, rgba(255,253,248,0.06), transparent)',
}}
```

- [ ] **Step 3: Run TypeScript to verify section changes compile**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/books-page.tsx
git commit -m "refactor(ui): warm empty state and chapter section spacing"
```

---

### Task 5: Full Verification and Visual QA

**Files:**
- Modify: `fanqie-workbench/src/web/pages/books-page.tsx`
- Test: existing app pages in browser

- [ ] **Step 1: Run TypeScript validation**

Run: `cd fanqie-workbench && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Run existing tests**

Run: `cd fanqie-workbench && npm test`
Expected: PASS with all existing tests green. This feature is visual-only, so no backend tests should regress.

- [ ] **Step 3: Run the app and manually verify the books page**

Run: `cd fanqie-workbench && npm run dev`

Open `http://localhost:5173`, go to **书籍管理**, expand a book, and verify:

- Chapter rows look like warm paper cards, not backend table rows
- The chapter number shows as `第X章`, not a bare number
- The title has a stronger visual hierarchy than the status text
- All chapter status pills use warm paper / tea / olive tones
- A processing chapter looks like the focused sheet on the desk
- A waiting chapter looks softened and low-priority
- The filtered empty state matches the warm paper theme
- Dark theme is still readable and does not become muddy
- Light theme is still readable and does not lose boundaries

- [ ] **Step 4: Commit final polish if any micro-adjustments were needed during visual QA**

If you made no further changes after QA, skip this step.

If you made small visual tweaks during QA, commit them with:

```bash
git add src/web/pages/books-page.tsx
git commit -m "refactor(ui): fine-tune warm chapter area polish"
```
