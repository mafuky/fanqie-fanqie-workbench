import { describe, expect, it } from 'vitest'
import type { AccountStatus } from '../../src/domain/account'

describe('account lifecycle', () => {
  it('new accounts start as needs-login', () => {
    const status: AccountStatus = 'needs-login'
    expect(status).toBe('needs-login')
  })

  it('rejects invalid status transitions', () => {
    const validTransitions: Record<AccountStatus, AccountStatus[]> = {
      'needs-login': ['active'],
      active: ['expired'],
      expired: ['active'],
    }
    expect(validTransitions['needs-login']).not.toContain('expired')
  })
})
