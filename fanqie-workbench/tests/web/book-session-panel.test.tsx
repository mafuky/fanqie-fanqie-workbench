import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BookSessionPanel } from '../../src/web/components/book-session-panel.js'

describe('BookSessionPanel', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })
  it('shows the standard book-level session fields and manual compression action', () => {
    render(
      <BookSessionPanel
        session={{
          id: 'master-1',
          status: 'running',
          currentSkill: 'book-master-session',
          updatedAt: '2026-05-14T10:00:00.000Z',
          metadata: { compressedAt: '2026-05-14T09:00:00.000Z' },
        }}
        onCompress={() => {}}
        onViewContext={() => {}}
      />,
    )

    expect(screen.getByText('书级主会话')).toBeTruthy()
    expect(screen.getByText('book-master-session')).toBeTruthy()
    expect(screen.getByText('压缩上下文')).toBeTruthy()
    expect(screen.getByText('查看上下文')).toBeTruthy()
  })

  it('invokes the context action when the user clicks 查看上下文', () => {
    const onViewContext = vi.fn()
    render(
      <BookSessionPanel
        session={{
          id: 'master-1',
          status: 'running',
          currentSkill: 'book-master-session',
          updatedAt: '2026-05-14T10:00:00.000Z',
          metadata: { compressedAt: '2026-05-14T09:00:00.000Z' },
        }}
        onCompress={() => {}}
        onViewContext={onViewContext}
      />,
    )

    fireEvent.click(screen.getByText('查看上下文'))
    expect(onViewContext).toHaveBeenCalledTimes(1)
  })
})
