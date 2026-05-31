import { describe, expect, it } from 'vitest'
import { routeAction } from '../../src/agentic/action-router.js'

describe('routeAction', () => {
  it('returns phase sequence for chapter.continue', () => {
    const phases = routeAction('chapter.continue')
    expect(phases.map((p) => p.name)).toEqual([
      'load-context', 'check-materials', 'write-chapter', 'update-tracking',
    ])
  })

  it('returns phase sequence for book.create', () => {
    const phases = routeAction('book.create')
    expect(phases.map((p) => p.name)).toEqual(['clarify-direction', 'scaffold-book'])
  })

  it('routes chapter.outline to load-context + write-outline', () => {
    expect(routeAction('chapter.outline').map((p) => p.name)).toEqual(['load-context', 'write-outline'])
  })

  it('routes chapter.revise to load-context + revise-chapter', () => {
    expect(routeAction('chapter.revise').map((p) => p.name)).toEqual(['load-context', 'revise-chapter'])
  })

  it('routes chapter.deslop to load-context + deslop-chapter', () => {
    expect(routeAction('chapter.deslop').map((p) => p.name)).toEqual(['load-context', 'deslop-chapter'])
  })

  it('routes chapter.review to load-context + review-chapter', () => {
    expect(routeAction('chapter.review').map((p) => p.name)).toEqual(['load-context', 'review-chapter'])
  })

  it('routes chapter.next to the four-phase one-shot pipeline', () => {
    expect(routeAction('chapter.next').map((p) => p.name)).toEqual(['load-context', 'write-outline', 'write-chapter', 'update-tracking'])
  })

  it('throws for unknown action', () => {
    expect(() => routeAction('chapter.unknown')).toThrow(/unknown action/i)
  })
})
