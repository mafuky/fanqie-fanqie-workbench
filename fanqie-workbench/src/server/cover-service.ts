import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface GenerateCoverInput {
  apiKey: string
  baseUrl: string
  model: string
  title: string
  bookRoot: string
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export interface GenerateCoverResult {
  /** Relative path inside the book root, e.g. "封面.png". */
  path: string
  absolutePath: string
}

/** Build a Chinese web-novel cover prompt from the book title. */
export function buildCoverPrompt(title: string): string {
  return [
    `为中文网络小说《${title}》设计一张竖版封面（3:4），中文网文风格。`,
    `要求：画面有强氛围感与冲突张力，主体清晰、构图有视觉中心；`,
    `把书名「${title}」作为标题文字醒目地排版在封面上，字体美观、与画面融合；`,
    `整体质感接近番茄/起点热门书的封面，不要水印、不要乱码文字。`,
  ].join('')
}

/**
 * Generate a cover via an OpenAI-compatible /images/generations endpoint and
 * save it as 封面.png inside the book root. Throws on missing config or upstream error.
 */
export async function generateCover(input: GenerateCoverInput): Promise<GenerateCoverResult> {
  if (!input.apiKey) throw new Error('image API key is not configured')
  const doFetch = input.fetchImpl ?? fetch
  const url = `${input.baseUrl.replace(/\/$/, '')}/images/generations`
  const res = await doFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      prompt: buildCoverPrompt(input.title),
      n: 1,
      size: '1024x1536',
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = text
    try { detail = JSON.parse(text)?.error?.message ?? text } catch { /* keep raw */ }
    throw new Error(`image API ${res.status}: ${detail.slice(0, 300)}`)
  }

  const body = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
  const item = body.data?.[0]
  if (!item) throw new Error('image API returned no data')

  let bytes: Buffer
  if (item.b64_json) {
    bytes = Buffer.from(item.b64_json, 'base64')
  } else if (item.url) {
    const imgRes = await doFetch(item.url)
    if (!imgRes.ok) throw new Error(`failed to download generated image: ${imgRes.status}`)
    bytes = Buffer.from(await imgRes.arrayBuffer())
  } else {
    throw new Error('image API returned neither b64_json nor url')
  }

  const relPath = '封面.png'
  const absolutePath = join(input.bookRoot, relPath)
  await writeFile(absolutePath, bytes)
  return { path: relPath, absolutePath }
}
