import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface GenerateCoverInput {
  apiKey: string
  baseUrl: string
  model: string
  title: string
  bookRoot: string
  /** Author pen name; when provided, an author-name line is added to the prompt. */
  author?: string
  /** Target platform; drives the overall visual style. Defaults to 番茄. */
  platform?: CoverPlatform
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export interface GenerateCoverResult {
  /** Relative path inside the book root, e.g. "封面.png". */
  path: string
  absolutePath: string
}

export type CoverPlatform = '番茄' | '起点' | '晋江' | '知乎盐言' | '七猫' | '刺猬猫'

export type CoverGenre =
  | 'xianxia'
  | 'urban'
  | 'ancient-romance'
  | 'modern-romance'
  | 'mystery'
  | 'scifi'
  | 'western-fantasy'
  | 'historical'
  | 'supernatural'
  | 'light-novel'

export interface BuildCoverPromptOptions {
  author?: string
  platform?: CoverPlatform
  /** Force a genre instead of inferring it from the title. */
  genre?: CoverGenre
}

/** Platform → overall visual style keywords (story-cover「平台风格」). */
const PLATFORM_STYLE: Record<CoverPlatform, string> = {
  番茄: 'vibrant saturated colors, eye-catching bold design, character portrait dominating the frame, high contrast, mass-market novel cover style',
  起点: 'polished refined illustration, detailed cinematic composition, epic atmospheric, mature sophisticated style, premium quality',
  晋江: 'dreamy ethereal aesthetic, soft pastel tones, elegant romantic, delicate beauty, flower petals and bokeh',
  知乎盐言: 'minimalist literary style, clean composition with negative space, subtle moody atmosphere, independent film poster aesthetic',
  七猫: 'striking high-impact design, vivid dramatic colors, spectacular visual effects, attention-grabbing poster style',
  刺猬猫: 'anime illustration style, vibrant colorful, detailed character art, Japanese light novel aesthetic',
}

interface GenreStyle {
  /** 书名字体风格 */
  titleFont: string
  /** 作者名字体风格 */
  authorFont: string
  /** 题材标签 + 人物 + 背景 + 色彩 + 光效 (story-cover「风格库」). */
  scene: string
}

const GENRE_STYLE: Record<CoverGenre, GenreStyle> = {
  xianxia: {
    titleFont: 'bold golden brush calligraphy with metallic glow and sharp strokes',
    authorFont:
      'small refined white serif text with faint golden glow, flanked by delicate cloud-scroll ornaments, resting on a thin horizontal gold line',
    scene:
      'Xianxia Chinese fantasy art style, ethereal atmosphere. A figure in flowing robes with wind-swept sleeves standing on a mountain peak, holding a glowing spirit sword. Ethereal clouds swirling below, misty immortal peaks, spiritual energy particles. Color palette: deep blue, gold, white, ink black. Divine golden light rays and mystical mist.',
  },
  urban: {
    titleFont: 'modern bold sans-serif with metallic silver finish',
    authorFont:
      'small clean white modern text with subtle drop shadow, positioned above a thin silver horizontal divider line',
    scene:
      'Modern urban contemporary style, clean cinematic composition. A sharply dressed confident figure with crisp defined silhouette. Background: city skyline or neon street at dusk, high-end interior. Color palette: deep blue, grey, gold accents. Sharp city lights, sunset glow reflecting on glass buildings, neon rim light.',
  },
  'ancient-romance': {
    titleFont: 'elegant golden traditional Kai script with ornate decoration',
    authorFont:
      'small elegant dark-red traditional text inside a thin golden rectangular border frame with corner decorations',
    scene:
      'Ancient Chinese romance palace-drama style, elegant classical beauty. A noble figure in luxurious crimson-and-gold court hanfu with ornate hairpins and refined makeup. Background: red palace walls, beaded curtains, screens and hanging lanterns. Color palette: imperial red, gold, ink black. Warm lantern light, golden candle glow, silk fabric shimmering.',
  },
  'modern-romance': {
    titleFont: 'soft rounded handwritten style in white with a warm glow',
    authorFont: 'small soft pink-white handwritten text with a tiny heart motif and light sparkle effect',
    scene:
      'Modern romance cover art, soft dreamy warm atmosphere. Two figures in a tender interaction, gazing at each other or almost touching. Background: warm interior, garden, or sunset cityscape. Color palette: soft pink, warm white, light gold. Soft warm backlighting, dreamy bokeh, gentle sunset glow.',
  },
  mystery: {
    titleFont: 'distorted bold cracked letters in blood red',
    authorFont:
      'small pale grey text with slight blur effect, almost hidden in the shadows, a thin cracked line underneath',
    scene:
      'Dark mystery thriller, noir atmosphere, high-contrast shadows. A silhouetted or half-hidden figure, cold and tense. Background: rainy night street, old building, dim alley. Color palette: black, deep grey, dark blue with blood-red and cold-white accents. Dramatic chiaroscuro, single spotlight, rain-slicked reflections.',
  },
  scifi: {
    titleFont: 'neon glowing futuristic font in electric blue',
    authorFont:
      'small crisp white monospace text with a subtle cyan scanline overlay, flanked by small geometric brackets',
    scene:
      'Sci-fi cyberpunk futuristic style. A figure in a tactical or mecha suit with a sci-fi weapon or holographic interface. Background: space, ruined city, or station. Color palette: deep blue, black, silver with neon-blue and electric-purple accents. Holographic blue glow, neon rim lighting, energy arcs.',
  },
  'western-fantasy': {
    titleFont: 'metallic embossed fantasy lettering with glow effect',
    authorFont:
      'small bronze medieval script text with aged parchment texture, enclosed in a small decorative shield or banner shape',
    scene:
      'Western high fantasy, epic medieval atmosphere. A knight in armor or a mage in robes, accompanied by a dragon or griffin. Background: castle, magic circle, vast plains. Color palette: deep blue, dark gold, silver-white with fire-red and magic-purple accents. Magic spell glow, dramatic stormy sky, torch firelight.',
  },
  historical: {
    titleFont: 'heavy stone-carved seal script in deep red',
    authorFont: 'small dignified white Song-typeface text above a double horizontal line in dark red',
    scene:
      'Historical Chinese war epic, grand battlefield panorama. A general in armor or a strategist in robes holding a weapon. Background: battlefield, city walls, military camp, beacon fires. Color palette: iron grey, dark red, earth yellow with gold-armor and ember-orange accents. Dramatic battlefield firelight, smoke-filled sky, sunset over war.',
  },
  supernatural: {
    titleFont: 'eerie dripping handwritten font in sickly green',
    authorFont: 'small faded grey-green text slightly tilted, with a thin dripping ink line above',
    scene:
      'Chinese supernatural horror, eerie ghostly atmosphere. A Taoist-clad figure or an ordinary person caught in something uncanny, with faint ghostly shapes. Background: graveyard, old temple, dark alley. Color palette: ink black, ghostly green, dark red with paper-white and candle-yellow accents. Eerie green glow, flickering candlelight, cold ghostly luminescence.',
  },
  'light-novel': {
    titleFont: 'colorful cartoon outlined bubbly font',
    authorFont: 'small playful rounded white text with a pastel color outline, tiny star decorations on both sides',
    scene:
      'Anime light-novel cover, vibrant colorful moe style. A cute moe character with anime attributes such as cat ears or wings. Background: fantasy world, campus, or starry sky. Bright multi-color palette with sparkle and petals. Sparkly star effects, magical particle effects, soft luminous glow.',
  },
}

/**
 * Ordered genre keyword table (story-cover「题材推断规则」). First match wins,
 * so more specific genres are listed before broader/overlapping ones.
 */
const GENRE_KEYWORDS: Array<{ genre: CoverGenre; keywords: string[] }> = [
  { genre: 'ancient-romance', keywords: ['妃', '皇', '侯', '宫', '嫡', '庶', '后', '朝', '凤', '鸾'] },
  { genre: 'xianxia', keywords: ['仙', '道', '剑', '灵', '修', '宗', '帝', '尊', '神'] },
  { genre: 'supernatural', keywords: ['鬼', '僵尸', '阴阳', '风水', '盗墓', '咒'] },
  { genre: 'mystery', keywords: ['诡', '案', '侦探', '悬疑', '推理', '密室', '连环'] },
  { genre: 'historical', keywords: ['三国', '大明', '大唐', '战场', '将军', '谋士'] },
  { genre: 'scifi', keywords: ['星际', '末世', '机甲', '赛博', '废土', '进化'] },
  { genre: 'western-fantasy', keywords: ['龙', '骑', '魔法', '异世界', '精灵', '领主'] },
  { genre: 'light-novel', keywords: ['萌', '喵', '团宠', '转生'] },
  { genre: 'urban', keywords: ['都市', '总裁', '校园', '重生', '系统', '学霸', '医生', '兵王'] },
  { genre: 'modern-romance', keywords: ['契约', '替嫁', '甜宠', '娇妻', '萌宝', '闪婚'] },
]

/** Infer a cover genre from the book title; defaults to modern-romance. */
export function inferGenre(title: string): CoverGenre {
  for (const { genre, keywords } of GENRE_KEYWORDS) {
    if (keywords.some((kw) => title.includes(kw))) return genre
  }
  return 'modern-romance'
}

/**
 * Build a professional Chinese web-novel cover prompt, layering platform style,
 * per-genre title/author fonts, and genre scene/color/light — following the
 * story-cover skill's prompt strategy. The genre is inferred from the title
 * unless overridden via opts.genre.
 */
export function buildCoverPrompt(title: string, opts: BuildCoverPromptOptions = {}): string {
  const platform: CoverPlatform = opts.platform ?? '番茄'
  const genre = opts.genre ?? inferGenre(title)
  const style = GENRE_STYLE[genre]

  const lines = [
    `Chinese web novel cover design, ${PLATFORM_STYLE[platform]}.`,
    `Title text '${title}' at top center in ${style.titleFont}.`,
  ]
  if (opts.author) {
    lines.push(`Author name '${opts.author}' at bottom center in ${style.authorFont}.`)
  }
  lines.push(`${style.scene} Digital painting style.`)
  lines.push('Professional book cover, high detail digital painting, portrait 2:3 ratio, no watermark.')
  return lines.join('\n')
}

/** Image-format sniffers used to validate user-supplied cover uploads. */
const IMAGE_MAGICS: Array<(b: Buffer) => boolean> = [
  (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, // PNG
  (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, // JPEG
  (b) => b.length >= 6 && b.toString('ascii', 0, 4) === 'GIF8', // GIF
  (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP', // WebP
]

/**
 * Decode a browser-supplied cover image — a "data:image/...;base64,..." data URL
 * or a raw base64 string — into bytes, validating it looks like a real image.
 */
export function decodeImageData(image: string): Buffer {
  if (!image || typeof image !== 'string') throw new Error('no image data provided')
  const match = /^data:image\/[\w.+-]+;base64,(.*)$/s.exec(image.trim())
  const b64 = (match ? match[1] : image).trim()
  if (!b64) throw new Error('no image data provided')
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length === 0) throw new Error('image data is empty')
  if (!IMAGE_MAGICS.some((test) => test(bytes))) {
    throw new Error('unsupported image format (expected PNG/JPEG/GIF/WebP)')
  }
  return bytes
}

export interface SaveCoverInput {
  bookRoot: string
  /** A "data:image/...;base64,..." data URL or raw base64 image string. */
  image: string
}

/** Save a user-supplied image as 封面.png inside the book root (manual fallback path). */
export async function saveCoverImage(input: SaveCoverInput): Promise<GenerateCoverResult> {
  const bytes = decodeImageData(input.image)
  const relPath = '封面.png'
  const absolutePath = join(input.bookRoot, relPath)
  await writeFile(absolutePath, bytes)
  return { path: relPath, absolutePath }
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
      prompt: buildCoverPrompt(input.title, { author: input.author, platform: input.platform }),
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
