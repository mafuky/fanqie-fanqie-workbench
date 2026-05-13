import type { ChapterStage } from '../../domain/chapter.js'

const stageColors: Record<string, string> = {
  '待写作': '#999',
  '已初稿': '#2196f3',
  '已去AI': '#ff9800',
  '已审稿': '#9c27b0',
  '可发布': '#4caf50',
  '发布中': '#f44336',
  '已发布': '#8bc34a',
}

export function ChapterStageBadge({ stage }: { stage: ChapterStage }) {
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 12,
      color: '#fff',
      background: stageColors[stage] || '#999'
    }}>
      {stage}
    </span>
  )
}
