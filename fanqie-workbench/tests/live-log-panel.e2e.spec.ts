import { test, expect } from '@playwright/test'

test('execution log keeps content stable across layout rerenders', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource
    let instances = 0
    let closes = 0

    class WrappedEventSource extends NativeEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict)
        instances += 1
      }

      close() {
        closes += 1
        return super.close()
      }
    }

    Object.defineProperty(window, '__logEventSourceStats', {
      value: {
        get instances() { return instances },
        get closes() { return closes },
      },
      configurable: true,
    })

    window.EventSource = WrappedEventSource
  })

  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [] }),
      })
      return
    }

    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ taskId: 'task-e2e', status: 'running' }),
      })
      return
    }

    await route.fallback()
  })

  await page.route('**/api/tasks/task-e2e/stream', async (route) => {
    const response = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const push = (chunk: string, delay: number) => {
          setTimeout(() => controller.enqueue(encoder.encode(chunk)), delay)
        }

        push('data: {"stream":"stdout","chunk":"第一行日志\\n"}\n\n', 0)
        push('data: {"stream":"stdout","chunk":"第二行日志\\n"}\n\n', 250)
        push('event: done\ndata: {"status":"succeeded"}\n\n', 1200)
        setTimeout(() => controller.close(), 1400)
      },
    })

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body: response,
    })
  })

  await page.goto('http://127.0.0.1:5173')
  await expect(page.getByRole('heading', { name: '执行任务' })).toBeVisible()

  await page.getByLabel('任务指令').fill('我想写一篇新的小说')
  await page.getByRole('button', { name: /执行/ }).click()

  await expect(page.getByText('第一行日志')).toBeVisible()
  await expect(page.getByText('第二行日志')).toBeVisible()

  await page.setViewportSize({ width: 700, height: 900 })
  await expect(page.getByText('第一行日志')).toBeVisible()
  await expect(page.getByText('第二行日志')).toBeVisible()

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByText('第一行日志')).toBeVisible()
  await expect(page.getByText('第二行日志')).toBeVisible()

  const stats = await page.evaluate(() => (window as any).__logEventSourceStats)
  expect(stats.instances).toBe(1)
  expect(stats.closes).toBe(0)

  await expect(page.getByText('✓ 成功')).toBeVisible()
})
