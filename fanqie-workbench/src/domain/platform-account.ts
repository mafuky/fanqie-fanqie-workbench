import type { AccountStatus } from './account.js'

export type PlatformAccountRecord = {
  id: string
  platform: string
  label: string
  profilePath: string | null
  cookiesJson: string | null
  status: AccountStatus
  lastCheckedAt: string | null
  createdAt: string
}
