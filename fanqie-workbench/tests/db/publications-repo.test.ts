import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/db/client'
import {
  createPlatformAccount,
  deletePlatformAccount,
  getPlatformAccountById,
  listPlatformAccounts,
  updatePlatformAccountCookies,
  updatePlatformAccountLabel,
  updatePlatformAccountStatus,
} from '../../src/db/repositories/platform-accounts-repo'
import {
  createBookPublication,
  getBookPublicationById,
  getBookPublicationsByBookId,
  updateBookPublicationBinding,
  updateBookPublicationStatus,
} from '../../src/db/repositories/book-publications-repo'
import { getChapterPublicationsByBookPublicationId, upsertChapterPublication } from '../../src/db/repositories/chapter-publications-repo'

afterEach(() => {
  vi.useRealTimers()
})

describe('multi-platform repositories', () => {
  it('creates platform accounts with platform-scoped profile paths and filters by known or custom platforms', () => {
    const db = openDatabase(':memory:')

    const fanqie = createPlatformAccount(db, { platform: 'fanqie', label: '番茄A' })
    const qimao = createPlatformAccount(db, { platform: 'qimao', label: '七猫B' })
    const custom = createPlatformAccount(db, { platform: 'wecom-serial', label: '定制平台C' })

    expect(fanqie.profilePath).toBe(`data/browser-profiles/fanqie-${fanqie.id}`)
    expect(qimao.profilePath).toBe(`data/browser-profiles/qimao-${qimao.id}`)
    expect(custom.profilePath).toBe(`data/browser-profiles/wecom-serial-${custom.id}`)
    expect(listPlatformAccounts(db, 'fanqie')).toEqual([
      expect.objectContaining({ id: fanqie.id, platform: 'fanqie', label: '番茄A' }),
    ])
    expect(listPlatformAccounts(db, 'qimao')).toEqual([
      expect.objectContaining({ id: qimao.id, platform: 'qimao', label: '七猫B' }),
    ])
    expect(listPlatformAccounts(db, 'wecom-serial')).toEqual([
      expect.objectContaining({ id: custom.id, platform: 'wecom-serial', label: '定制平台C' }),
    ])
    expect(listPlatformAccounts(db)).toHaveLength(3)

    db.close()
  })

  it('creates one publication target per book and platform', () => {
    const db = openDatabase(':memory:')
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES ('b1', '测试书', '/tmp/book')`).run()

    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄A' })
    const publication = createBookPublication(db, {
      bookId: 'b1',
      platform: 'fanqie',
      platformAccountId: account.id,
    })

    expect(publication).toMatchObject({
      bookId: 'b1',
      platform: 'fanqie',
      platformAccountId: account.id,
      platformBookId: null,
      status: 'draft',
    })
    expect(getBookPublicationsByBookId(db, 'b1')).toEqual([
      expect.objectContaining({ id: publication.id, platform: 'fanqie', platformAccountId: account.id }),
    ])
    expect(() =>
      createBookPublication(db, {
        bookId: 'b1',
        platform: 'fanqie',
        platformAccountId: account.id,
      })
    ).toThrow()

    db.close()
  })

  it('rejects publication bindings when the account platform does not match', () => {
    const db = openDatabase(':memory:')
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES ('b1', '测试书', '/tmp/book')`).run()

    const fanqieAccount = createPlatformAccount(db, { platform: 'fanqie', label: '番茄A' })

    expect(() =>
      createBookPublication(db, {
        bookId: 'b1',
        platform: 'qimao',
        platformAccountId: fanqieAccount.id,
      }),
    ).toThrow()

    db.close()
  })

  it('binds and updates book publications through targeted repository helpers', () => {
    vi.useFakeTimers()
    const createdAt = new Date('2026-05-13T08:00:00.000Z')
    const boundAt = new Date('2026-05-13T08:05:00.000Z')
    const pausedAt = new Date('2026-05-13T08:10:00.000Z')

    const db = openDatabase(':memory:')
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES ('b1', '测试书', '/tmp/book')`).run()
    const account = createPlatformAccount(db, { platform: 'qimao', label: '七猫A' })

    vi.setSystemTime(createdAt)
    const publication = createBookPublication(db, {
      bookId: 'b1',
      platform: 'qimao',
      platformAccountId: account.id,
    })

    expect(getBookPublicationById(db, publication.id)).toMatchObject({
      id: publication.id,
      bookId: 'b1',
      platform: 'qimao',
      platformAccountId: account.id,
      platformBookId: null,
      status: 'draft',
      createdAt: '2026-05-13T08:00:00.000Z',
      updatedAt: '2026-05-13T08:00:00.000Z',
    })

    vi.setSystemTime(boundAt)
    updateBookPublicationBinding(db, publication.id, {
      platformBookId: 'qimao-book-1',
      status: 'bound',
    })

    expect(getBookPublicationById(db, publication.id)).toMatchObject({
      id: publication.id,
      platformBookId: 'qimao-book-1',
      status: 'bound',
      updatedAt: '2026-05-13T08:05:00.000Z',
    })

    vi.setSystemTime(pausedAt)
    updateBookPublicationStatus(db, publication.id, 'paused')

    expect(getBookPublicationById(db, publication.id)).toMatchObject({
      id: publication.id,
      platformBookId: 'qimao-book-1',
      status: 'paused',
      updatedAt: '2026-05-13T08:10:00.000Z',
    })

    db.close()
  })

  it('maps nullable profile paths and updates platform accounts via minimal CRUD helpers', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-13T12:34:56.000Z'))

    const db = openDatabase(':memory:')
    db.prepare(
      `INSERT INTO platform_accounts (id, platform, label, profile_path, cookies_json, status, last_checked_at, created_at)
       VALUES ('manual-null', 'qimao', '七猫导入账号', NULL, NULL, 'needs-login', NULL, '2026-05-13T00:00:00.000Z')`,
    ).run()

    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄A' })

    expect(getPlatformAccountById(db, 'manual-null')).toMatchObject({
      id: 'manual-null',
      platform: 'qimao',
      label: '七猫导入账号',
      profilePath: null,
      cookiesJson: null,
      status: 'needs-login',
      lastCheckedAt: null,
    })
    expect(getPlatformAccountById(db, account.id)).toMatchObject({
      id: account.id,
      platform: 'fanqie',
      label: '番茄A',
      cookiesJson: null,
      status: 'needs-login',
      lastCheckedAt: null,
    })

    updatePlatformAccountLabel(db, account.id, '番茄主号')
    updatePlatformAccountCookies(db, account.id, '[{"name":"sid","value":"1"}]')
    updatePlatformAccountStatus(db, account.id, 'active')

    expect(getPlatformAccountById(db, account.id)).toMatchObject({
      id: account.id,
      label: '番茄主号',
      cookiesJson: '[{"name":"sid","value":"1"}]',
      status: 'active',
      lastCheckedAt: '2026-05-13T12:34:56.000Z',
    })

    deletePlatformAccount(db, account.id)
    expect(getPlatformAccountById(db, account.id)).toBeNull()

    db.close()
  })

  it('upserts chapter publications by chapter and publication target without duplicates', () => {
    const db = openDatabase(':memory:')
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES ('b1', '测试书', '/tmp/book')`).run()
    db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES ('c1', 'b1', 1, '第一章', '/tmp/book/1.md', '可发布')`).run()

    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄A' })
    const bookPublication = createBookPublication(db, {
      bookId: 'b1',
      platform: 'fanqie',
      platformAccountId: account.id,
    })

    upsertChapterPublication(db, {
      chapterId: 'c1',
      bookPublicationId: bookPublication.id,
      platformChapterId: 'remote-c1-v1',
      status: 'synced',
    })

    const firstPass = getChapterPublicationsByBookPublicationId(db, bookPublication.id)
    expect(firstPass).toHaveLength(1)
    expect(firstPass[0]).toMatchObject({
      chapterId: 'c1',
      bookPublicationId: bookPublication.id,
      platformChapterId: 'remote-c1-v1',
      status: 'synced',
      lastPublishedAt: null,
    })

    upsertChapterPublication(db, {
      chapterId: 'c1',
      bookPublicationId: bookPublication.id,
      platformChapterId: 'remote-c1-v2',
      status: 'published',
    })

    const secondPass = getChapterPublicationsByBookPublicationId(db, bookPublication.id)
    expect(secondPass).toHaveLength(1)
    expect(secondPass[0]).toMatchObject({
      chapterId: 'c1',
      bookPublicationId: bookPublication.id,
      platformChapterId: 'remote-c1-v2',
      status: 'published',
    })
    expect(secondPass[0].lastPublishedAt).toEqual(expect.any(String))

    db.close()
  })

  it('preserves lastPublishedAt when a published chapter later becomes failed', () => {
    vi.useFakeTimers()
    const publishedAt = new Date('2026-05-13T08:00:00.000Z')
    const failedAt = new Date('2026-05-13T09:00:00.000Z')

    const db = openDatabase(':memory:')
    db.prepare(`INSERT INTO books (id, title, root_path) VALUES ('b1', '测试书', '/tmp/book')`).run()
    db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES ('c1', 'b1', 1, '第一章', '/tmp/book/1.md', '可发布')`).run()

    const account = createPlatformAccount(db, { platform: 'fanqie', label: '番茄A' })
    const bookPublication = createBookPublication(db, {
      bookId: 'b1',
      platform: 'fanqie',
      platformAccountId: account.id,
    })

    vi.setSystemTime(publishedAt)
    upsertChapterPublication(db, {
      chapterId: 'c1',
      bookPublicationId: bookPublication.id,
      platformChapterId: 'remote-c1-v1',
      status: 'published',
    })

    const publishedPass = getChapterPublicationsByBookPublicationId(db, bookPublication.id)
    expect(publishedPass).toHaveLength(1)
    const firstPublishedAt = publishedPass[0].lastPublishedAt
    expect(firstPublishedAt).toBe('2026-05-13T08:00:00.000Z')

    vi.setSystemTime(failedAt)
    upsertChapterPublication(db, {
      chapterId: 'c1',
      bookPublicationId: bookPublication.id,
      platformChapterId: 'remote-c1-v1',
      status: 'failed',
    })

    const failedPass = getChapterPublicationsByBookPublicationId(db, bookPublication.id)
    expect(failedPass).toHaveLength(1)
    expect(failedPass[0]).toMatchObject({
      chapterId: 'c1',
      bookPublicationId: bookPublication.id,
      platformChapterId: 'remote-c1-v1',
      status: 'failed',
      lastPublishedAt: '2026-05-13T08:00:00.000Z',
      updatedAt: '2026-05-13T09:00:00.000Z',
    })
    expect(failedPass[0].lastPublishedAt).toBe(firstPublishedAt)

    db.close()
  })
})
