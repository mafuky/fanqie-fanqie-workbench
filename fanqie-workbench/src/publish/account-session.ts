export async function openLoginBrowser(profilePath: string, targetUrl: string) {
  const { chromium } = await import('playwright')
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: 'chrome',
  })
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(targetUrl)
  return { context, page }
}

export async function loadPublishContext(profilePath: string) {
  const { chromium } = await import('playwright')
  return chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: 'chrome',
  })
}
