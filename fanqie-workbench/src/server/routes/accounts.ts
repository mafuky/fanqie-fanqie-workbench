import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../../db/client.js'
import { createAccount, getAccounts } from '../../db/repositories/accounts-repo.js'
import {
  createPlatformAccount,
  deletePlatformAccount,
  getPlatformAccountById,
  listPlatformAccounts,
  updatePlatformAccountCookies,
  updatePlatformAccountLabel,
  updatePlatformAccountStatus,
} from '../../db/repositories/platform-accounts-repo.js'
import type { AccountStatus } from '../../domain/account.js'
import type { PlatformAccountRecord } from '../../domain/platform-account.js'
import { isSupportedPlatform } from '../../domain/platform.js'
import { openLoginBrowser } from '../../publish/account-session.js'
import { FANQIE_AUTHOR_URL } from '../../publish/fanqie-adapter.js'
import { getPublishPlatformAdapter } from '../../publish/platform-registry.js'

const VALID_ACCOUNT_STATUSES: AccountStatus[] = ['needs-login', 'active', 'expired']

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

function readNonEmptyString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === 'string' && VALID_ACCOUNT_STATUSES.includes(value as AccountStatus)
}

function toPublicPlatformAccount(account: PlatformAccountRecord): Omit<PlatformAccountRecord, 'cookiesJson'> {
  const { cookiesJson: _cookiesJson, ...publicAccount } = account
  return publicAccount
}

function hasStoredCookies(cookiesJson: string | null) {
  return typeof cookiesJson === 'string' && cookiesJson.trim().length > 0
}

function parsePlatformAccountPatch(body: Record<string, unknown>) {
  const allowedKeys = ['label', 'status', 'cookiesJson']
  const extraKeys = Object.keys(body).filter((key) => !allowedKeys.includes(key))
  if (extraKeys.length > 0) {
    return { error: 'PATCH body only supports label, status, cookiesJson' as const }
  }

  const patch: {
    label?: string
    status?: AccountStatus
    cookiesJson?: string | null
  } = {}

  if (body.label !== undefined) {
    const label = readNonEmptyString(body.label)
    if (!label) {
      return { error: 'label must be a non-empty string' as const }
    }
    patch.label = label
  }

  if (body.status !== undefined) {
    if (!isAccountStatus(body.status)) {
      return { error: 'status must be one of needs-login, active, expired' as const }
    }
    patch.status = body.status
  }

  if (body.cookiesJson !== undefined) {
    if (body.cookiesJson !== null && typeof body.cookiesJson !== 'string') {
      return { error: 'cookiesJson must be a string or null' as const }
    }
    patch.cookiesJson = body.cookiesJson
  }

  return { patch }
}

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async () => {
    const db = openDatabase(getDatabasePath())
    const accounts = getAccounts(db)
    db.close()
    return { accounts }
  })

  app.post<{ Body: { label: string } }>('/api/accounts', async (request, reply) => {
    const label = readNonEmptyString(request.body?.label)
    if (!label) return reply.code(400).send({ error: 'label is required' })

    const db = openDatabase(getDatabasePath())
    const account = createAccount(db, label)
    db.close()
    return reply.code(201).send(account)
  })

  app.get<{ Querystring: { platform?: string } }>('/api/platform-accounts', async (request, reply) => {
    const platform = request.query?.platform
    if (platform !== undefined && !isSupportedPlatform(platform)) {
      return reply.code(400).send({ error: 'platform is required' })
    }

    const db = openDatabase(getDatabasePath())
    try {
      const accounts = listPlatformAccounts(db, platform).map(toPublicPlatformAccount)
      return { accounts }
    } finally {
      db.close()
    }
  })

  app.post<{ Body: { platform?: string; label?: string } }>('/api/platform-accounts', async (request, reply) => {
    const platform = readNonEmptyString(request.body?.platform)
    if (!platform || !isSupportedPlatform(platform)) {
      return reply.code(400).send({ error: 'platform is required' })
    }

    const label = readNonEmptyString(request.body?.label)
    if (!label) {
      return reply.code(400).send({ error: 'label is required' })
    }

    const db = openDatabase(getDatabasePath())
    try {
      const account = createPlatformAccount(db, { platform, label })
      return reply.code(201).send(toPublicPlatformAccount(account))
    } finally {
      db.close()
    }
  })

  app.get<{ Params: { id: string } }>('/api/platform-accounts/:id', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    try {
      const account = getPlatformAccountById(db, request.params.id)
      if (!account) return reply.code(404).send({ error: 'platform account not found' })
      return toPublicPlatformAccount(account)
    } finally {
      db.close()
    }
  })

  app.patch<{
    Params: { id: string }
    Body: { label?: string; status?: AccountStatus; cookiesJson?: string | null }
  }>('/api/platform-accounts/:id', async (request, reply) => {
    const { id } = request.params
    const body = request.body || {}
    const parsed = parsePlatformAccountPatch(body)
    if ('error' in parsed) {
      return reply.code(400).send({ error: parsed.error })
    }

    const db = openDatabase(getDatabasePath())
    try {
      const existing = getPlatformAccountById(db, id)
      if (!existing) {
        return reply.code(404).send({ error: 'platform account not found' })
      }

      if (parsed.patch.label !== undefined) {
        updatePlatformAccountLabel(db, id, parsed.patch.label)
      }

      if (parsed.patch.status !== undefined) {
        updatePlatformAccountStatus(db, id, parsed.patch.status)
      }

      if (parsed.patch.cookiesJson !== undefined) {
        updatePlatformAccountCookies(db, id, parsed.patch.cookiesJson)
      }

      const updated = getPlatformAccountById(db, id)
      return updated ? toPublicPlatformAccount(updated) : reply.code(404).send({ error: 'platform account not found' })
    } finally {
      db.close()
    }
  })

  app.delete<{ Params: { id: string } }>('/api/platform-accounts/:id', async (request, reply) => {
    const db = openDatabase(getDatabasePath())
    try {
      const existing = getPlatformAccountById(db, request.params.id)
      if (!existing) {
        return reply.code(404).send({ error: 'platform account not found' })
      }

      try {
        deletePlatformAccount(db, request.params.id)
      } catch (error) {
        if (error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message)) {
          return reply.code(409).send({
            error: 'platform account is still referenced by one or more book publications',
          })
        }
        throw error
      }

      return reply.code(204).send()
    } finally {
      db.close()
    }
  })

  app.post<{ Params: { id: string } }>('/api/platform-accounts/:id/login-session', async (request, reply) => {
    const { id } = request.params
    const db = openDatabase(getDatabasePath())
    let account: PlatformAccountRecord | null = null
    try {
      account = getPlatformAccountById(db, id)
    } finally {
      db.close()
    }

    if (!account) return reply.code(404).send({ error: 'platform account not found' })
    if (!account.profilePath) {
      return reply.code(400).send({ error: 'platform account is missing profilePath' })
    }

    const adapter = getPublishPlatformAdapter(account.platform)
    if (!adapter) {
      return reply.code(202).send({
        accountId: id,
        started: false,
        status: 'adapter-missing',
        error: `No adapter registered for platform "${account.platform}"`,
      })
    }

    if (account.platform === 'fanqie') {
      try {
        await openLoginBrowser(account.profilePath, FANQIE_AUTHOR_URL)
      } catch (error) {
        if (error instanceof Error && /现有的浏览器会话中打开|Target page, context or browser has been closed/i.test(error.message)) {
          return reply.code(409).send({
            error: 'platform account browser profile is already in use by an existing Chrome session',
          })
        }
        throw error
      }

      return reply.code(202).send({
        accountId: id,
        started: true,
        status: account.status,
        platform: account.platform,
      })
    }

    return reply.code(202).send({
      accountId: id,
      started: false,
      status: 'not-wired',
      message: `Login session for platform "${account.platform}" is not wired yet`,
    })
  })

  app.post<{ Params: { id: string } }>('/api/platform-accounts/:id/check-health', async (request, reply) => {
    const { id } = request.params
    const db = openDatabase(getDatabasePath())
    try {
      const account = getPlatformAccountById(db, id)
      if (!account) return reply.code(404).send({ error: 'platform account not found' })

      const cookiesJson = account.cookiesJson?.trim()
      if (!cookiesJson) {
        if (account.status !== 'needs-login') {
          updatePlatformAccountStatus(db, id, 'needs-login')
        }

        return {
          accountId: id,
          checked: true,
          status: 'needs-login' as const,
        }
      }

      try {
        JSON.parse(cookiesJson)
      } catch {
        if (account.status !== 'needs-login') {
          updatePlatformAccountStatus(db, id, 'needs-login')
        }

        return {
          accountId: id,
          checked: true,
          status: 'needs-login' as const,
        }
      }

      return {
        accountId: id,
        checked: true,
        status: account.status,
      }
    } finally {
      db.close()
    }
  })
}
