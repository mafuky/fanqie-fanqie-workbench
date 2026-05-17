import { Card } from './ui/card.js'
import { Button } from './ui/button.js'
import { spacing } from '../styles/tokens.js'

export type ChapterActionKey = 'chapter-polish' | 'chapter-deslop' | 'chapter-review' | 'chapter-rewrite'

const ACTIONS: Array<{ key: ChapterActionKey; label: string }> = [
  { key: 'chapter-polish', label: '润色' },
  { key: 'chapter-deslop', label: '去AI味' },
  { key: 'chapter-review', label: '审稿' },
  { key: 'chapter-rewrite', label: '重写本章' },
]

export function ChapterActionMenu({ onSelect }: { onSelect: (key: ChapterActionKey) => void }) {
  return (
    <Card style={{ marginTop: spacing.sm }}>
      <div style={{ display: 'grid', gap: spacing.sm }}>
        {ACTIONS.map((action) => (
          <Button key={action.key} variant="secondary" onClick={() => onSelect(action.key)}>
            {action.label}
          </Button>
        ))}
      </div>
    </Card>
  )
}
