import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ClaudeExecutionPanel } from '../../src/web/components/claude-execution-panel.js'

vi.mock('../../src/web/components/live-log-panel.js', () => ({
  LiveLogPanel: ({ taskId, streamBase, onDone, onAnswerSubmitted, onPermissionBlocked }: any) => (
    <div>
      <div>执行日志</div>
      <div>session:{taskId}</div>
      <div>stream:{streamBase}</div>
      <button onClick={() => onDone?.('succeeded')}>mock done</button>
      <button onClick={() => onAnswerSubmitted?.('继续')}>mock answer</button>
      <button onClick={() => onPermissionBlocked?.({
        kind: 'bash-permission',
        title: 'Claude 正在等待 Bash 权限确认',
        excerpt: 'Bash command\nDo you want to proceed?',
        recommendation: '请确认命令内容。',
        terminalInstruction: '请回到终端按 Enter。',
      })}>mock permission</button>
    </div>
  ),
}))

describe('ClaudeExecutionPanel', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ interrupted: true }) })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows action label and session log', () => {
    render(<ClaudeExecutionPanel sessionId="s1" actionLabel="继续写本章" />)
    expect(screen.getByText('继续写本章')).toBeTruthy()
    expect(screen.getByText('执行日志')).toBeTruthy()
    expect(screen.getByText('stream:sessions')).toBeTruthy()
  })

  it('calls session interrupt and onInterrupted when stop is clicked', async () => {
    const onInterrupted = vi.fn()
    render(<ClaudeExecutionPanel sessionId="s1" actionLabel="继续写本章" onInterrupted={onInterrupted} />)
    fireEvent.click(screen.getByText('停止'))
    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions/s1/interrupt', expect.objectContaining({ method: 'POST' }))
      expect(onInterrupted).toHaveBeenCalled()
    })
  })

  it('shows interrupt error when stop fails', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '停止失败' }) })
    render(<ClaudeExecutionPanel sessionId="s1" actionLabel="继续写本章" />)
    fireEvent.click(screen.getByText('停止'))
    expect(await screen.findByText('停止失败')).toBeTruthy()
  })

  it('calls onDone when LiveLogPanel completes', async () => {
    const onDone = vi.fn()
    render(<ClaudeExecutionPanel sessionId="s1" actionLabel="继续写本章" onDone={onDone} />)
    fireEvent.click(screen.getByText('mock done'))
    expect(onDone).toHaveBeenCalledWith('succeeded')
  })

  it('calls onAnswerSubmitted when LiveLogPanel answers a question', async () => {
    const onAnswerSubmitted = vi.fn()
    render(<ClaudeExecutionPanel sessionId="s1" actionLabel="继续写本章" onAnswerSubmitted={onAnswerSubmitted} />)
    fireEvent.click(screen.getByText('mock answer'))
    expect(onAnswerSubmitted).toHaveBeenCalledWith('继续')
  })

  it('renders permission prompt helper when session stream reports permission-blocked', async () => {
    render(<ClaudeExecutionPanel sessionId="s1" actionLabel="继续写本章" />)

    fireEvent.click(screen.getByText('mock permission'))

    expect(await screen.findByText('权限提示助手')).toBeTruthy()
    expect(screen.getByText('Claude 正在等待 Bash 权限确认')).toBeTruthy()
    expect(screen.getByText('请回到终端按 Enter。')).toBeTruthy()
  })
})
