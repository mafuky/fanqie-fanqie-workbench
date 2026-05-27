import { describe, expect, it } from 'vitest'
import { buildActionCommand } from '../../src/actions/action-command-builder.js'
import { getActionBinding, normalizeActionKey } from '../../src/actions/action-registry.js'

describe('action registry', () => {
  it('contains default chapter action bindings', () => {
    expect(getActionBinding('chapter.continue')).toMatchObject({
      actionKey: 'chapter.continue',
      scope: 'chapter',
      capability: 'oh-story-claudecode',
      command: '/story-long-write',
      legacyCurrentSkill: 'chapter-pipeline',
    })
    expect(getActionBinding('chapter.deslop').command).toBe('/story-deslop')
    expect(getActionBinding('chapter.review').command).toBe('/story-review')
  })

  it('normalizes legacy currentSkill values', () => {
    expect(normalizeActionKey('chapter-pipeline')).toBe('chapter.continue')
    expect(normalizeActionKey('chapter-polish')).toBe('chapter.polish')
    expect(normalizeActionKey('chapter-deslop')).toBe('chapter.deslop')
    expect(normalizeActionKey('chapter-review')).toBe('chapter.review')
    expect(normalizeActionKey('chapter-rewrite')).toBe('chapter.rewrite')
  })

  it('throws for unknown actions', () => {
    expect(() => getActionBinding('unknown.action' as never)).toThrow('Unknown action')
  })

  it('builds a chapter command through the existing chapter command builder', () => {
    const command = buildActionCommand({
      actionKey: 'chapter.continue',
      bookTitle: '雾港疑局',
      bookRoot: '/tmp/book',
      chapterNumber: 37,
      chapterTitle: '暴雨夜的第二具尸体',
      chapterPath: '/tmp/book/正文/第037章_暴雨夜的第二具尸体.md',
    })

    expect(command).toContain('/story-long-write')
    expect(command).toContain('日更《雾港疑局》第 37 章')
    expect(command).toContain('书籍目录：/tmp/book')
    expect(command).toContain('章节文件：/tmp/book/正文/第037章_暴雨夜的第二具尸体.md')
  })
})
