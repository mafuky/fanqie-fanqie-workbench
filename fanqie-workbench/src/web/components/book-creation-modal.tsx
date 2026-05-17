import { useState, useEffect } from 'react'
import { Modal } from './ui/modal.js'
import { Textarea } from './ui/input.js'
import { Button } from './ui/button.js'

const COMMON_TEMPLATES = [
  '现代悬疑复仇文，强反转',
  '女频豪门追妻火葬场，带悬疑线',
  '男频诡异修仙，前期压抑后期爆发',
  '都市刑侦悬疑，双强对抗，节奏快',
  '古言权谋复仇，女主黑化成长',
  '无限流规则怪谈，强钩子高压感',
]

export function BookCreationModal({
  open,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (idea: string) => Promise<void>
  loading: boolean
}) {
  const [idea, setIdea] = useState('')

  useEffect(() => {
    if (!open) setIdea('')
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建一本书"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={() => onSubmit(idea.trim())} disabled={!idea.trim()} loading={loading}>开始生成</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Textarea
          label="开书想法"
          value={idea}
          onChange={(e) => setIdea(e.currentTarget.value)}
          placeholder="例如：现代悬疑复仇文，强反转"
          rows={4}
        />

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>常用模板</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {COMMON_TEMPLATES.map((template) => (
              <Button key={template} variant="secondary" size="sm" onClick={() => setIdea(template)}>
                {template}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
