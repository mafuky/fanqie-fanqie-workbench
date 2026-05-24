export type MarketScanPresetKey =
  | 'fanqie-female-reading'
  | 'fanqie-male-reading'
  | 'qidian-signnewbook'
  | 'qidian-hotsales'
  | 'dz-female'
  | 'heiyan-booklist'

export type MarketScanPreset = {
  key: MarketScanPresetKey
  label: string
  scriptPath: string
  args: string[]
}

const presets: Record<MarketScanPresetKey, MarketScanPreset> = {
  'fanqie-female-reading': {
    key: 'fanqie-female-reading',
    label: '番茄女频阅读榜',
    scriptPath: 'oh-story-claudecode/skills/story-long-scan/scripts/fanqie-rank-scraper.js',
    args: ['--channel', '0', '--type', '2'],
  },
  'fanqie-male-reading': {
    key: 'fanqie-male-reading',
    label: '番茄男频阅读榜',
    scriptPath: 'oh-story-claudecode/skills/story-long-scan/scripts/fanqie-rank-scraper.js',
    args: ['--channel', '1', '--type', '2'],
  },
  'qidian-signnewbook': {
    key: 'qidian-signnewbook',
    label: '起点签约作者新书榜',
    scriptPath: 'oh-story-claudecode/skills/story-long-scan/scripts/qidian-rank-scraper.js',
    args: ['--rank', 'signnewbook'],
  },
  'qidian-hotsales': {
    key: 'qidian-hotsales',
    label: '起点畅销榜',
    scriptPath: 'oh-story-claudecode/skills/story-long-scan/scripts/qidian-rank-scraper.js',
    args: ['--rank', 'hotsales'],
  },
  'dz-female': {
    key: 'dz-female',
    label: '点众女频短篇',
    scriptPath: 'oh-story-claudecode/skills/story-short-scan/scripts/dz-browse-scraper.js',
    args: ['--channel', 'female'],
  },
  'heiyan-booklist': {
    key: 'heiyan-booklist',
    label: '黑岩短篇书库',
    scriptPath: 'oh-story-claudecode/skills/story-short-scan/scripts/heiyan-booklist-scraper.js',
    args: [],
  },
}

export function listMarketScanPresets() {
  return Object.values(presets)
}

export function getMarketScanPreset(key: MarketScanPresetKey | string) {
  const preset = presets[key as MarketScanPresetKey]
  if (!preset) throw new Error(`Unknown market scan preset: ${key}`)
  return preset
}
