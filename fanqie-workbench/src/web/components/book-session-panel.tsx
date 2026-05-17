import { Badge } from './ui/badge.js'
import { Button } from './ui/button.js'
import { Card } from './ui/card.js'
import { fontSize, fontWeight, spacing } from '../styles/tokens.js'

export function BookSessionPanel({ session, onCompress, onViewContext }: {
  session: {
    id: string
    status: string
    currentSkill: string | null
    updatedAt: string
    metadata?: { compressedAt?: string | null }
  } | null
  onCompress: () => void
  onViewContext: () => void
}) {
  return (
    <Card>
      <div style={{ display: 'grid', gap: spacing.sm }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold }}>书级主会话</div>
          <Badge variant={session?.status === 'running' ? 'warning' : 'neutral'}>{session?.status || '未建立'}</Badge>
        </div>
        <div style={{ fontSize: fontSize.sm }}>{session?.currentSkill || 'book-master-session'}</div>
        <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>最近更新：{session ? new Date(session.updatedAt).toLocaleString('zh-CN') : '暂无'}</div>
        <div style={{ fontSize: fontSize.xs, color: 'var(--text-muted)' }}>最近压缩：{session?.metadata?.compressedAt ? new Date(session.metadata.compressedAt).toLocaleString('zh-CN') : '未压缩'}</div>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <Button variant="secondary" onClick={onViewContext}>查看上下文</Button>
          <Button onClick={onCompress}>压缩上下文</Button>
        </div>
      </div>
    </Card>
  )
}
