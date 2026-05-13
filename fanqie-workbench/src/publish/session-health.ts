export async function checkSessionHealth(
  profilePath: string,
  authorBackendUrl: string
): Promise<'active' | 'expired'> {
  const { chromium } = await import('playwright')
  const context = await chromium.launchPersistentContext(profilePath, { headless: true })
  const page = await context.newPage()
  await page.goto(authorBackendUrl)
  const isLoginPage = page.url().includes('login')
  await context.close()
  return isLoginPage ? 'expired' : 'active'
}
