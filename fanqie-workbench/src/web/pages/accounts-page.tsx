import { useState, useEffect, useCallback, useRef } from 'react'
import { getPlatformLabel, type KnownPlatform } from '../../domain/platform.js'
import { PageHeader } from '../components/ui/page-header.js'
import { Card } from '../components/ui/card.js'
import { Input } from '../components/ui/input.js'
import { Button } from '../components/ui/button.js'
import { Badge } from '../components/ui/badge.js'
import { Table } from '../components/ui/table.js'
import { Confirm } from '../components/ui/modal.js'
import { Spinner } from '../components/ui/spinner.js'
import { useToast } from '../components/ui/toast.js'
import { fontWeight, spacing, fontSize, radius, transition } from '../styles/tokens.js'

type Account = {
  id: string
  platform: string
  label: string
  status: string
  lastCheckedAt: string | null
  createdAt: string
}

const PLATFORM_TABS: KnownPlatform[] = ['fanqie', 'qimao', 'qidian']

const statusBadge: Record<string, { variant: 'success' | 'error' | 'warning'; label: string }> = {
  active: { variant: 'success', label: '已登录' },
  expired: { variant: 'error', label: '已过期' },
  'needs-login': { variant: 'warning', label: '需登录' },
}

export function AccountsPage() {
  const [platform, setPlatform] = useState<KnownPlatform>('fanqie')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [loggingInId, setLoggingInId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const latestLoadRequest = useRef(0)
  const toast = useToast()

  const loadAccounts = useCallback(async (nextPlatform = platform) => {
    const requestId = latestLoadRequest.current + 1
    latestLoadRequest.current = requestId
    setLoading(true)
    try {
      const res = await fetch(`/api/platform-accounts?platform=${nextPlatform}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '加载账号失败')
      if (latestLoadRequest.current !== requestId) return
      setAccounts(data.accounts || [])
    } catch (error) {
      if (latestLoadRequest.current === requestId) {
        toast.error(error instanceof Error ? error.message : '加载账号失败')
      }
    } finally {
      if (latestLoadRequest.current === requestId) {
        setLoading(false)
      }
    }
  }, [platform, toast])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const handleAdd = useCallback(async () => {
    if (!newLabel.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/platform-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, label: newLabel.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '添加失败')
      setNewLabel('')
      toast.success('账号已添加')
      await loadAccounts()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加失败')
    } finally {
      setAdding(false)
    }
  }, [newLabel, loadAccounts, platform, toast])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/platform-accounts/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '删除失败')
      toast.success('账号已删除')
      setDeleteTarget(null)
      await loadAccounts()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadAccounts, toast])

  const handleLogin = useCallback(async (id: string) => {
    setLoggingInId(id)
    try {
      const res = await fetch(`/api/platform-accounts/${id}/login-session`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.message || '登录失败')
      toast.success(data.message || '已发起登录')
      await loadAccounts()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '登录失败')
    } finally {
      setLoggingInId(null)
    }
  }, [loadAccounts, toast])

  const handleCheck = useCallback(async (id: string) => {
    setCheckingId(id)
    try {
      const res = await fetch(`/api/platform-accounts/${id}/check-health`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '检查失败')
      toast.success(data.status ? `当前状态：${statusBadge[data.status]?.label || data.status}` : '检查完成')
      await loadAccounts()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '检查失败')
    } finally {
      setCheckingId(null)
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
      width: 210,
      render: (row: Account) => (
        <div style={{ display: 'flex', gap: spacing.sm - 2, flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={() => handleLogin(row.id)} loading={loggingInId === row.id}>
            登录
          </Button>
          <Button variant="secondary" size="sm" onClick={() => handleCheck(row.id)} loading={checkingId === row.id}>
            检查
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleteTarget(row)}>
            删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="账号管理" description="管理各发布平台账号与登录态" />

      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        {PLATFORM_TABS.map((tab) => {
          const active = platform === tab
          return (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setPlatform(tab)
              }}
              style={{
                padding: `${spacing.xs}px ${spacing.md - 2}px`,
                background: active ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: radius.sm,
                fontSize: fontSize.sm,
                fontWeight: active ? fontWeight.medium : fontWeight.normal,
                fontFamily: 'inherit',
                cursor: 'pointer',
                transition: `all ${transition.fast}`,
              }}
            >
              {getPlatformLabel(tab)}
            </button>
          )
        })}
      </div>

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
