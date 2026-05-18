import { describe, expect, it } from 'vitest'
import { AdapterNotConfiguredError } from '../../src/publish/publisher-adapter'
import { FANQIE_AUTHOR_URL, FANQIE_SELECTORS } from '../../src/publish/fanqie-adapter'
import { getPublishPlatformAdapter, listPublishPlatformAdapters } from '../../src/publish/platform-registry'

function createPageDouble(currentUrl = 'https://author.fanqie.com/workbench') {
  const gotoCalls: Array<{ url: string; options: unknown }> = []

  return {
    gotoCalls,
    page: {
      goto: async (url: string, options: unknown) => {
        gotoCalls.push({ url, options })
      },
      url: () => currentUrl
    }
  }
}

describe('platform registry', () => {
  it('returns adapters in configured platform order', () => {
    expect(listPublishPlatformAdapters().map((adapter) => adapter.platform)).toEqual([
      'fanqie',
      'qimao',
      'qidian'
    ])
  })

  it('returns null for unknown platforms', () => {
    expect(getPublishPlatformAdapter('unknown-platform')).toBeNull()
  })
})

describe('fanqie adapter', () => {
  it('preserves existing exported constants', () => {
    expect(FANQIE_AUTHOR_URL).toBe('https://fanqienovel.com/main/writer/login')
    expect(FANQIE_SELECTORS.loginIndicator).toBe('.writer-login, #slogin-pc-login-form')
  })

  it('opens the fanqie backend with domcontentloaded', async () => {
    const fanqie = getPublishPlatformAdapter('fanqie')
    const { gotoCalls, page } = createPageDouble()

    await fanqie!.openBackend(page as never)

    expect(gotoCalls).toEqual([
      {
        url: FANQIE_AUTHOR_URL,
        options: { waitUntil: 'domcontentloaded' }
      }
    ])
  })

  it('rejects obvious login pages', async () => {
    const fanqie = getPublishPlatformAdapter('fanqie')
    const { page } = createPageDouble('https://fanqienovel.com/main/writer/login')

    await expect(fanqie!.ensureLoggedIn(page as never)).rejects.toThrow(/login/i)
  })

  it('treats non-login writer pages as authenticated enough for the current runner path', async () => {
    const fanqie = getPublishPlatformAdapter('fanqie')
    const { page } = createPageDouble('https://fanqienovel.com/main/writer/creator/home')

    await expect(fanqie!.ensureLoggedIn(page as never)).resolves.toBeUndefined()
  })

  it('throws until unresearched fanqie capabilities are configured', async () => {
    const fanqie = getPublishPlatformAdapter('fanqie')
    const { page } = createPageDouble()

    await expect(fanqie!.listBooks(page as never)).rejects.toBeInstanceOf(AdapterNotConfiguredError)
    await expect(
      fanqie!.bindBook(page as never, {
        id: 'local-book-1',
        title: '本地书籍',
        rootPath: '/novels/local-book-1'
      })
    ).rejects.toBeInstanceOf(AdapterNotConfiguredError)
    await expect(
      fanqie!.publishChapter(page as never, {
        bookPublicationId: 'book-publication-1',
        chapterId: 'chapter-1',
        platformBookId: 'platform-book-1',
        platformChapterId: 'platform-chapter-1',
        title: '第一章',
        content: '章节内容'
      })
    ).rejects.toBeInstanceOf(AdapterNotConfiguredError)
    await expect(
      fanqie!.verifyChapter(page as never, {
        platformBookId: 'platform-book-1',
        platformChapterId: 'platform-chapter-1',
        title: '第一章'
      })
    ).rejects.toBeInstanceOf(AdapterNotConfiguredError)
  })
})

describe('unresearched adapters', () => {
  it('throw adapter-not-configured errors for qimao and qidian capabilities', async () => {
    for (const platform of ['qimao', 'qidian'] as const) {
      const adapter = getPublishPlatformAdapter(platform)
      const { page } = createPageDouble()

      await expect(adapter!.openBackend(page as never)).rejects.toBeInstanceOf(AdapterNotConfiguredError)
      await expect(adapter!.ensureLoggedIn(page as never)).rejects.toBeInstanceOf(AdapterNotConfiguredError)
      await expect(adapter!.listBooks(page as never)).rejects.toBeInstanceOf(AdapterNotConfiguredError)
    }
  })
})
