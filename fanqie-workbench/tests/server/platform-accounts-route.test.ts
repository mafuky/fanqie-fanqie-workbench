import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { createPlatformAccount, getPlatformAccountById } from '../../src/db/repositories/platform-accounts-repo.js'
import { openLoginBrowser } from '../../src/publish/account-session.js'
import { buildServer } from '../../src/server/app.js'

vi.mock('../../src/publish/account-session.js', () => ({
  openLoginBrowser: vi.fn().mockResolvedValue({}),
  loadPublishContext: vi.fn(),
}))

function expectPublicAccountShape(account: Record<string, unknown>) {
  expect(account).not.toHaveProperty('cookiesJson')
}

async function createTempDatabasePath(name: string) {
  const dir = await mkdtemp(resolve(tmpdir(), 'fanqie-workbench-platform-accounts-route-'))
  return resolve(dir, name)
}

describe('platform accounts route', () => {
  afterEach(() => {
    delete process.env.WORKBENCH_DB
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('creates and lists qimao platform accounts with platform filter', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-list.sqlite')
    process.env.WORKBENCH_DB = databasePath

    const app = await buildServer()

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/platform-accounts',
      payload: { platform: 'qimao', label: '七猫主号' },
    })

    expect(createResponse.statusCode).toBe(201)
    const created = JSON.parse(createResponse.body)
    expect(created.platform).toBe('qimao')
    expect(created.label).toBe('七猫主号')
    expect(created.status).toBe('needs-login')
    expectPublicAccountShape(created)

    const allResponse = await app.inject({ method: 'GET', url: '/api/platform-accounts' })
    expect(allResponse.statusCode).toBe(200)
    const allAccounts = JSON.parse(allResponse.body).accounts
    expect(allAccounts).toHaveLength(1)
    expectPublicAccountShape(allAccounts[0])

    const filteredResponse = await app.inject({ method: 'GET', url: '/api/platform-accounts?platform=qimao' })
    expect(filteredResponse.statusCode).toBe(200)
    const filteredAccounts = JSON.parse(filteredResponse.body).accounts
    expect(filteredAccounts).toEqual([
      expect.objectContaining({ id: created.id, platform: 'qimao', label: '七猫主号' }),
    ])
    expectPublicAccountShape(filteredAccounts[0])

    await app.close()
  })

  it('gets patches and deletes a platform account', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-crud.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const getResponse = await app.inject({ method: 'GET', url: `/api/platform-accounts/${account.id}` })
    expect(getResponse.statusCode).toBe(200)
    const fetched = JSON.parse(getResponse.body)
    expect(fetched).toEqual(expect.objectContaining({ id: account.id, label: '番茄主号' }))
    expectPublicAccountShape(fetched)

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/platform-accounts/${account.id}`,
      payload: { label: '番茄副号', status: 'expired', cookiesJson: '{"session":"abc"}', ignored: true },
    })
    expect(patchResponse.statusCode).toBe(400)
    expect(JSON.parse(patchResponse.body)).toEqual({ error: 'PATCH body only supports label, status, cookiesJson' })

    const deleteResponse = await app.inject({ method: 'DELETE', url: `/api/platform-accounts/${account.id}` })
    expect(deleteResponse.statusCode).toBe(204)

    const missingResponse = await app.inject({ method: 'GET', url: `/api/platform-accounts/${account.id}` })
    expect(missingResponse.statusCode).toBe(404)

    await app.close()
  })

  it('returns a readable conflict when deleting an account still referenced by a publication', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-delete-conflict.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '主号' })
    db.prepare('INSERT INTO books (id, title, root_path, account_id) VALUES (?, ?, ?, NULL)').run('book-1', '测试书', '/tmp/book-1')
    db.prepare(
      `INSERT INTO book_publications (id, book_id, platform, platform_account_id, platform_book_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('publication-1', 'book-1', 'fanqie', account.id, null, 'draft', '2026-05-14T00:00:00.000Z', '2026-05-14T00:00:00.000Z')
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({ method: 'DELETE', url: `/api/platform-accounts/${account.id}` })
    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body)).toEqual({
      error: 'platform account is still referenced by one or more book publications',
    })

    const stillExists = await app.inject({ method: 'GET', url: `/api/platform-accounts/${account.id}` })
    expect(stillExists.statusCode).toBe(200)

    await app.close()
  })

  it('rejects blank platform and label on create', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-invalid-create.sqlite')
    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const blankPlatform = await app.inject({
      method: 'POST',
      url: '/api/platform-accounts',
      payload: { platform: '   ', label: '有效标签' },
    })
    expect(blankPlatform.statusCode).toBe(400)

    const blankLabel = await app.inject({
      method: 'POST',
      url: '/api/platform-accounts',
      payload: { platform: 'fanqie', label: '   ' },
    })
    expect(blankLabel.statusCode).toBe(400)

    await app.close()
  })

  it('returns 404 for legacy capture-session route', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-capture-session.sqlite')
    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({ method: 'POST', url: '/api/accounts/nonexistent/capture-session' })
    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('returns adapter-missing status when no platform adapter is registered', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-login-session-missing-adapter.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'custom-platform', label: '自定义平台账号' })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: `/api/platform-accounts/${account.id}/login-session`,
    })

    expect(response.statusCode).toBe(202)
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        accountId: account.id,
        started: false,
        status: 'adapter-missing',
        error: 'No adapter registered for platform "custom-platform"',
      }),
    )

    await app.close()
  })

  it('starts fanqie login session with persistent profile without changing account status to active', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-login-session.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄待登录' })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: `/api/platform-accounts/${account.id}/login-session`,
    })

    expect(response.statusCode).toBe(202)
    expect(JSON.parse(response.body)).toEqual({
      accountId: account.id,
      started: true,
      status: 'needs-login',
      platform: 'fanqie',
    })
    expect(openLoginBrowser).toHaveBeenCalledWith(account.profilePath, 'https://fanqienovel.com/main/writer/login')

    const verifyDb = openDatabase(databasePath)
    const stored = getPlatformAccountById(verifyDb, account.id)
    verifyDb.close()

    expect(stored?.status).toBe('needs-login')

    await app.close()
  })

  it('returns clear error when login session profilePath is missing', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-login-session-missing-profile.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄待登录' })
    db.prepare('UPDATE platform_accounts SET profile_path = NULL WHERE id = ?').run(account.id)
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: `/api/platform-accounts/${account.id}/login-session`,
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual({
      error: 'platform account is missing profilePath',
    })
    expect(openLoginBrowser).not.toHaveBeenCalled()

    await app.close()
  })

  it('returns readable conflict when browser profile is already in use', async () => {
    vi.mocked(openLoginBrowser).mockRejectedValueOnce(new Error('browserType.launchPersistentContext: Target page, context or browser has been closed\n正在现有的浏览器会话中打开。'))

    const databasePath = await createTempDatabasePath('platform-accounts-route-login-session-profile-in-use.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄待登录' })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: `/api/platform-accounts/${account.id}/login-session`,
    })

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body)).toEqual({
      error: 'platform account browser profile is already in use by an existing Chrome session',
    })

    await app.close()
  })

  it('reconciles empty cookies to needs-login during health check and keeps response sanitized', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-check-health.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄健康检查' })
    db.prepare('UPDATE platform_accounts SET status = ?, cookies_json = ? WHERE id = ?').run('active', '', account.id)
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: `/api/platform-accounts/${account.id}/check-health`,
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      accountId: account.id,
      checked: true,
      status: 'needs-login',
    })

    const verifyDb = openDatabase(databasePath)
    const stored = getPlatformAccountById(verifyDb, account.id)
    verifyDb.close()

    expect(stored?.status).toBe('needs-login')
    expect(stored?.cookiesJson).toBe('')

    await app.close()
  })

  it('reconciles malformed cookies to needs-login during health check', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-check-health-invalid-cookies.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄健康检查' })
    db.prepare('UPDATE platform_accounts SET status = ?, cookies_json = ? WHERE id = ?').run('active', '{bad-json', account.id)
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'POST',
      url: `/api/platform-accounts/${account.id}/check-health`,
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      accountId: account.id,
      checked: true,
      status: 'needs-login',
    })

    const verifyDb = openDatabase(databasePath)
    const stored = getPlatformAccountById(verifyDb, account.id)
    verifyDb.close()

    expect(stored?.status).toBe('needs-login')
    expect(stored?.lastCheckedAt).toBeTruthy()

    await app.close()
  })

  it('starts fanqie login session when adapter.platform matches without requiring adapter class identity', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-login-session-platform-check.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄待登录' })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const loginModule = await import('../../src/publish/account-session.js')
    const registryModule = await import('../../src/publish/platform-registry.js')
    const loginBrowserMock = vi.mocked(loginModule.openLoginBrowser)
    const originalGetPublishPlatformAdapter = registryModule.getPublishPlatformAdapter
    loginBrowserMock.mockClear()
    vi.spyOn(registryModule, 'getPublishPlatformAdapter').mockReturnValue({ platform: 'fanqie' } as never)

    const response = await app.inject({
      method: 'POST',
      url: `/api/platform-accounts/${account.id}/login-session`,
    })

    expect(response.statusCode).toBe(202)
    expect(JSON.parse(response.body)).toEqual({
      accountId: account.id,
      started: true,
      status: 'needs-login',
      platform: 'fanqie',
    })
    expect(loginBrowserMock).toHaveBeenCalledWith(account.profilePath, 'https://fanqienovel.com/main/writer/login')
    expect(vi.mocked(registryModule.getPublishPlatformAdapter)).toHaveBeenCalledWith('fanqie')

    await app.close()
  })


  it('rejects invalid patch status values without persisting earlier field updates', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-invalid-patch.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/platform-accounts/${account.id}`,
      payload: { label: '已变更标签', status: 'broken' },
    })

    expect(response.statusCode).toBe(400)

    const getResponse = await app.inject({ method: 'GET', url: `/api/platform-accounts/${account.id}` })
    expect(getResponse.statusCode).toBe(200)
    expect(JSON.parse(getResponse.body)).toEqual(expect.objectContaining({ label: '番茄主号' }))

    await app.close()
  })

  it('persists cookiesJson without echoing it in public responses', async () => {
    const databasePath = await createTempDatabasePath('platform-accounts-route-sanitized-cookies.sqlite')
    const db = openDatabase(databasePath)
    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄主号' })
    db.close()

    process.env.WORKBENCH_DB = databasePath
    const app = await buildServer()

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/platform-accounts/${account.id}`,
      payload: { cookiesJson: '{"session":"abc"}' },
    })

    expect(patchResponse.statusCode).toBe(200)
    const patched = JSON.parse(patchResponse.body)
    expect(patched).toEqual(expect.objectContaining({ id: account.id, label: '番茄主号' }))
    expectPublicAccountShape(patched)

    const getResponse = await app.inject({ method: 'GET', url: `/api/platform-accounts/${account.id}` })
    expect(getResponse.statusCode).toBe(200)
    expectPublicAccountShape(JSON.parse(getResponse.body))

    const listResponse = await app.inject({ method: 'GET', url: '/api/platform-accounts' })
    expect(listResponse.statusCode).toBe(200)
    const listed = JSON.parse(listResponse.body).accounts
    expect(listed).toHaveLength(1)
    expectPublicAccountShape(listed[0])

    const verifyDb = openDatabase(databasePath)
    const stored = getPlatformAccountById(verifyDb, account.id)
    verifyDb.close()

    expect(stored?.cookiesJson).toBe('{"session":"abc"}')

    await app.close()
  })
})
