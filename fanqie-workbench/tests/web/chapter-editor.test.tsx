import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChapterEditor } from '../../src/web/components/chapter-editor.js'

describe('ChapterEditor', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/chapters/chapter-1/content' && !init) {
        return {
          ok: true,
          json: async () => ({
            chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1, sourcePath: '/tmp/book/正文/第001章_雾夜失踪.md' },
            content: '# 第001章 雾夜失踪\n\n旧内容\n',
          }),
        }
      }
      if (input === '/api/chapters/chapter-1/content' && init?.method === 'PUT') {
        return { ok: true, json: async () => ({ saved: true }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads chapter content', async () => {
    render(<ChapterEditor chapterId="chapter-1" />)
    expect(await screen.findByDisplayValue(/旧内容/)).toBeTruthy()
  })

  it('shows dirty state and word count after editing', async () => {
    render(<ChapterEditor chapterId="chapter-1" />)
    const editor = await screen.findByLabelText('章节正文')
    fireEvent.change(editor, { target: { value: '# 第001章 雾夜失踪\n\n新内容' } })
    expect(screen.getByText('未保存')).toBeTruthy()
    expect(screen.getByText(/字数/)).toBeTruthy()
  })

  it('saves edited content', async () => {
    const onSaved = vi.fn()
    render(<ChapterEditor chapterId="chapter-1" onSaved={onSaved} />)
    const editor = await screen.findByLabelText('章节正文')
    fireEvent.change(editor, { target: { value: '# 第001章 雾夜失踪\n\n新内容\n' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/chapters/chapter-1/content', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: '# 第001章 雾夜失踪\n\n新内容\n' }),
      }))
      expect(onSaved).toHaveBeenCalled()
    })
  })

  it('shows conflict when save returns 409', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (!init) return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '旧内容' }) }
      return { ok: false, status: 409, json: async () => ({ error: 'chapter is being modified by a running Claude session' }) }
    })

    render(<ChapterEditor chapterId="chapter-1" />)
    fireEvent.change(await screen.findByLabelText('章节正文'), { target: { value: '新内容' } })
    fireEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('Claude 正在修改本书，暂时不能覆盖保存。')).toBeTruthy()
  })

  it('reloads chapter content when reloadKey changes', async () => {
    let content = '旧内容'
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/chapters/chapter-1/content' && !init) {
        return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    const view = render(<ChapterEditor chapterId="chapter-1" reloadKey={0} />)
    expect(await screen.findByDisplayValue('旧内容')).toBeTruthy()

    content = '新内容'
    view.rerender(<ChapterEditor chapterId="chapter-1" reloadKey={1} />)

    expect(await screen.findByDisplayValue('新内容')).toBeTruthy()
  })

  it('rewrites a multi-line selection: AI bar → candidate → diff → accept → replaces + toast', async () => {
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/chapters/chapter-1/content' && !init) {
        return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: 't', chapterNumber: 1 }, content: '他微微一笑。\n然后离开了。\n剩下她一人。' }) }
      }
      if (input === '/api/sentence/revise' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ candidates: ['他笑了笑。\n转身走了。', '他咧了咧嘴。\n抬脚就走。'] }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<ChapterEditor chapterId="chapter-1" />)
    const editor = (await screen.findByLabelText('章节正文')) as HTMLTextAreaElement

    // Select the first TWO lines "他微微一笑。\n然后离开了。" (indices 0..13) — a multi-line span.
    editor.focus()
    editor.setSelectionRange(0, 13)
    fireEvent.select(editor)

    fireEvent.click(await screen.findByText('去AI味'))

    await waitFor(() => {
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/api/sentence/revise', expect.objectContaining({ method: 'POST' }))
    })

    // The whole selection (both lines) was sent, not just one line.
    const reviseCall = (globalThis as any).fetch.mock.calls.find((c: any[]) => c[0] === '/api/sentence/revise')
    expect(JSON.parse(reviseCall[1].body).sentence).toBe('他微微一笑。\n然后离开了。')

    // Pick a candidate → a diff preview appears (not an immediate replace).
    fireEvent.click(await screen.findByText(/他笑了笑/))
    expect(await screen.findByTestId('sentence-diff')).toBeTruthy()
    expect(editor.value).toBe('他微微一笑。\n然后离开了。\n剩下她一人。') // unchanged until accepted

    // Accept → replaces the selection, leaving the untouched third line intact, and shows a toast.
    fireEvent.click(screen.getByText('接受'))
    await waitFor(() => expect(editor.value).toBe('他笑了笑。\n转身走了。\n剩下她一人。'))
    expect(await screen.findByTestId('editor-toast')).toBeTruthy()
  })

  it('shows load error and retries chapter content load', async () => {
    let shouldFail = true
    ;(globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/chapters/chapter-1/content' && !init) {
        if (shouldFail) return { ok: false, status: 500, json: async () => ({ error: '读取失败' }) }
        return { ok: true, json: async () => ({ chapter: { id: 'chapter-1', title: '雾夜失踪', chapterNumber: 1 }, content: '恢复后的内容' }) }
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    render(<ChapterEditor chapterId="chapter-1" />)

    expect(await screen.findByText('读取失败')).toBeTruthy()
    shouldFail = false
    fireEvent.click(screen.getByText('重试'))

    expect(await screen.findByDisplayValue('恢复后的内容')).toBeTruthy()
  })
})
