import { FanqiePublishPlatformAdapter } from './fanqie-adapter.js'
import type { PublishPlatformAdapter } from './publisher-adapter.js'
import { QidianPublishPlatformAdapter } from './qidian-adapter.js'
import { QimaoPublishPlatformAdapter } from './qimao-adapter.js'

const adapters: PublishPlatformAdapter[] = [
  new FanqiePublishPlatformAdapter(),
  new QimaoPublishPlatformAdapter(),
  new QidianPublishPlatformAdapter()
]

export function listPublishPlatformAdapters() {
  return [...adapters]
}

export function getPublishPlatformAdapter(platform: string) {
  return adapters.find((adapter) => adapter.platform === platform) ?? null
}
