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
