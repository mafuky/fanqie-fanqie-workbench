import { describe, expect, it, vi } from 'vitest'

const gotoMock = vi.fn(async () => undefined)
const newPageMock = vi.fn(async () => ({ goto: gotoMock }))
const launchPersistentContextMock = vi.fn(async () => ({
  pages: () => [],
  newPage: newPageMock,
}))

vi.mock('playwright', () => ({
  chromium: {
    launchPersistentContext: launchPersistentContextMock,
  },
}))

describe('account session helpers', () => {
  it('opens login browser with domcontentloaded navigation for login pages', async () => {
    const { openLoginBrowser } = await import('../../src/publish/account-session.js')

    await openLoginBrowser('/tmp/fanqie-profile', 'https://fanqienovel.com/main/writer/login')

    expect(launchPersistentContextMock).toHaveBeenCalledWith('/tmp/fanqie-profile', {
      headless: false,
      channel: 'chrome',
    })
    expect(gotoMock).toHaveBeenCalledWith('https://fanqienovel.com/main/writer/login', {
      waitUntil: 'domcontentloaded',
    })
  })
})
