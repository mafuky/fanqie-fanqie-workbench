import type { ChapterStage } from '../domain/chapter.js'
import type { OrchestrationGoal } from './goal-types.js'

export function routeGoal(goal: OrchestrationGoal, stage: ChapterStage) {
  if (goal.type === 'draft-chapter' && stage === '待写作') {
    return { skillName: 'chinese-novelist-skill' }
  }

  if (goal.type === 'deai-chapter' && stage === '已初稿') {
    return { skillName: 'oh-story-claudecode' }
  }

  if (goal.type === 'review-chapter' && stage === '已去AI') {
    return { skillName: 'oh-story-claudecode' }
  }

  throw new Error(`Unsupported goal/stage pair: ${goal.type} @ ${stage}`)
}
