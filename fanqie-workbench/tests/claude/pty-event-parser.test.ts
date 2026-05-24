import { describe, expect, it } from 'vitest'
import { PtyEventParser } from '../../src/claude/pty-event-parser.js'

describe('PtyEventParser', () => {
  it('detects a single-select question', () => {
    const parser = new PtyEventParser()
    const events = parser.feed(`
Some text above

❯ 1. Option A
  2. Option B
  3. Option C

Enter to select · Tab/Arrow keys to navigate
`)
    expect(events).toEqual([{
      type: 'question',
      question: '请选择一个选项。',
      options: [
        { label: '1. Option A' },
        { label: '2. Option B' },
        { label: '3. Option C' },
      ],
      multiSelect: false,
    }])
  })

  it('detects a multi-select question with checkboxes', () => {
    const parser = new PtyEventParser()
    const events = parser.feed(`
你的写作优势是什么？

  1. [ ] 脑洞好
  2. [✔] 文笔好
❯ 3. [✔] 节奏感好
  4. [ ] 生活经验丰富

Enter to select · Tab/Arrow keys
`)
    expect(events).toHaveLength(1)
    const q = events[0]
    expect(q.type).toBe('question')
    if (q.type !== 'question') return
    expect(q.multiSelect).toBe(true)
    expect(q.options[1].checked).toBe(true)
    expect(q.options[0].checked).toBe(false)
  })

  it('detects thinking spinner', () => {
    const parser = new PtyEventParser()
    const events = parser.feed('✻ Crystallizing… (23s · thinking more with xhigh effort)\n')
    expect(events).toEqual([{
      type: 'thinking',
      text: '✻ Crystallizing… (23s · thinking more with xhigh effort)',
    }])
  })

  it('detects idle prompt after Claude output', () => {
    const parser = new PtyEventParser()
    parser.feed('⏺ Here is my response.\n')
    const events = parser.feed(`
✻ Worked for 5m 30s
────────────────────────────────────────
❯
────────────────────────────────────────
`)
    expect(events).toContainEqual({ type: 'idle' })
  })

  it('does not detect idle before Claude has output', () => {
    const parser = new PtyEventParser()
    const events = parser.feed(`
────────────────────────────────────────
❯ /story-long-write some command
────────────────────────────────────────
`)
    expect(events.filter(e => e.type === 'idle')).toHaveLength(0)
  })

  it('detects permission prompt', () => {
    const parser = new PtyEventParser()
    const events = parser.feed(`
⏺ Bash command: rm -rf /tmp/test

  Do you want to proceed? No
`)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('permission')
  })

  it('clears stale question when new content arrives', () => {
    const parser = new PtyEventParser()
    const q = parser.feed('❯ 1. Opt A\n  2. Opt B\nEnter to select\n')
    expect(q).toHaveLength(1)
    const next = parser.feed('⏺ Processing your selection...\n')
    expect(next.filter(e => e.type === 'question')).toHaveLength(0)
  })

  it('rolling buffer stays under max size', () => {
    const parser = new PtyEventParser(100)
    parser.feed('a'.repeat(200))
    expect(parser.getBuffer().length).toBeLessThanOrEqual(100)
  })
})
