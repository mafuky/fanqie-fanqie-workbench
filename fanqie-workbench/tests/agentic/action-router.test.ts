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

  it('throws for unknown action', () => {
    expect(() => routeAction('chapter.unknown')).toThrow(/unknown action/i)
  })
})
