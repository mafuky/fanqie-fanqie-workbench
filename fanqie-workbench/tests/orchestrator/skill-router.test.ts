import { describe, expect, it } from 'vitest'
import { routeGoal } from '../../src/orchestrator/skill-router'

describe('skill routing', () => {
  it('routes draft goals to chinese-novelist-skill', () => {
    const route = routeGoal({ type: 'draft-chapter', bookId: 'b1', chapterId: 'c1' }, '待写作')
    expect(route.skillName).toBe('chinese-novelist-skill')
  })

  it('routes deai goals to oh-story-claudecode', () => {
    const route = routeGoal({ type: 'deai-chapter', bookId: 'b1', chapterId: 'c1' }, '已初稿')
    expect(route.skillName).toBe('oh-story-claudecode')
  })
})
