import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionPromptCard } from '../../src/web/components/permission-prompt-card.js'

const detection = {
  kind: 'bash-permission' as const,
  title: 'Claude 正在等待 Bash 权限确认',
  excerpt: 'Bash command\nmkdir -p novels/夜里追踪/设定\nDo you want to proceed?',
  recommendation: '请确认命令内容和路径属于当前工作，再决定是否允许。',
  terminalInstruction: '可以在这里允许本次或拒绝；不会选择始终允许。',
}

describe('PermissionPromptCard', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ handled: true }) })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders permission prompt guidance with action buttons', () => {
    render(<PermissionPromptCard detection={detection} sessionId="session-1" />)

    expect(screen.getByText('Claude 正在等待 Bash 权限确认')).toBeTruthy()
    expect(screen.getByText('请确认命令内容和路径属于当前工作，再决定是否允许。')).toBeTruthy()
    expect(screen.getByText(/不会选择始终允许/)).toBeTruthy()
    expect(screen.getByText(/mkdir -p novels/)).toBeTruthy()
    expect(screen.getByText('允许本次')).toBeTruthy()
    expect(screen.getByText('拒绝')).toBeTruthy()
    expect(screen.queryByText('Yes, and always allow')).toBeNull()
  })

  it('submits allow-once from the web card', async () => {
    const onHandled = vi.fn()
    render(<PermissionPromptCard detection={detection} sessionId="session-1" onHandled={onHandled} />)

    fireEvent.click(screen.getByText('允许本次'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sessions/session-1/permission', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ choice: 'allow-once' }),
      }))
      expect(onHandled).toHaveBeenCalledWith('allow-once')
    })
  })

  it('keeps card visible and shows an error when permission submit fails', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '权限处理失败' }) })
    render(<PermissionPromptCard detection={detection} sessionId="session-1" />)

    fireEvent.click(screen.getByText('允许本次'))

    expect(await screen.findByText('权限处理失败')).toBeTruthy()
    expect(screen.getByText('Claude 正在等待 Bash 权限确认')).toBeTruthy()
  })
})
