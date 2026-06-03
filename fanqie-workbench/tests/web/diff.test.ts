import { describe, expect, it } from 'vitest'
import { diffChars, type DiffPart } from '../../src/web/lib/diff'

const join = (parts: DiffPart[], skip: 'ins' | 'del') =>
  parts.filter((p) => p.type !== skip).map((p) => p.text).join('')

describe('diffChars', () => {
  it('returns a single eq run for identical strings', () => {
    expect(diffChars('abc', 'abc')).toEqual([{ type: 'eq', text: 'abc' }])
  })

  it('marks a pure insertion / deletion', () => {
    expect(diffChars('', 'ab')).toEqual([{ type: 'ins', text: 'ab' }])
    expect(diffChars('ab', '')).toEqual([{ type: 'del', text: 'ab' }])
  })

  it('coalesces consecutive same-type chars into runs', () => {
    const parts = diffChars('abc', 'axc')
    expect(parts).toEqual([
      { type: 'eq', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'ins', text: 'x' },
      { type: 'eq', text: 'c' },
    ])
  })

  it('reconstructs both inputs (eq+del = a, eq+ins = b) for Chinese prose', () => {
    const a = '她听见有人在远处喊她的名字。又一道雷。'
    const b = '远处有人喊她的名字，声音被雷声撕碎。'
    const parts = diffChars(a, b)
    expect(join(parts, 'ins')).toBe(a) // drop insertions → original
    expect(join(parts, 'del')).toBe(b) // drop deletions → rewrite
  })

  it('preserves newlines (multi-line selection) in the reconstruction', () => {
    const a = '第一句。\n第二句。\n第三句。'
    const b = '第一句改。\n第二句。\n第三句也改。'
    const parts = diffChars(a, b)
    expect(join(parts, 'ins')).toBe(a)
    expect(join(parts, 'del')).toBe(b)
  })

  it('falls back to a whole-block replace past the size guard', () => {
    const a = '甲'.repeat(1500)
    const b = '乙'.repeat(1500)
    expect(diffChars(a, b)).toEqual([
      { type: 'del', text: a },
      { type: 'ins', text: b },
    ])
  })
})
