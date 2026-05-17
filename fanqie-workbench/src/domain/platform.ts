export type KnownPlatform = 'fanqie' | 'qimao' | 'qidian'
export type SupportedPlatform = KnownPlatform | (string & {})

const KNOWN_PLATFORM_LABELS: Record<KnownPlatform, string> = {
  fanqie: '番茄小说',
  qimao: '七猫小说',
  qidian: '起点中文网',
}

export const KNOWN_PLATFORMS: KnownPlatform[] = Object.keys(KNOWN_PLATFORM_LABELS) as KnownPlatform[]
export const SUPPORTED_PLATFORMS: SupportedPlatform[] = [...KNOWN_PLATFORMS]

export function isKnownPlatform(value: string): value is KnownPlatform {
  return Object.hasOwn(KNOWN_PLATFORM_LABELS, value)
}

export function isSupportedPlatform(value: string): value is SupportedPlatform {
  return value.trim().length > 0
}

export function getPlatformLabel(platform: SupportedPlatform): string {
  return isKnownPlatform(platform) ? KNOWN_PLATFORM_LABELS[platform] : platform
}
