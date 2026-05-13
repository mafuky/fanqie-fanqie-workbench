export type AccountStatus = 'active' | 'expired' | 'needs-login'

export type AccountRecord = {
  id: string
  label: string
  profilePath: string
  status: AccountStatus
  lastCheckedAt: string | null
  createdAt: string
}
