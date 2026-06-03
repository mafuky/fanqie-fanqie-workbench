import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { registerReviewCheckpointRoutes } from '../../src/server/routes/review-checkpoints'
import { createVolumeReconcileCheckpoint } from '../../src/server/review-checkpoint-service'

const MARK = '## 实际完成 vs 计划偏差(对账)'

async function setup() {
  const dir = await mkdtemp(resolve(tmpdir(), 'wb-rrv-'))
  const bookRoot = resolve(dir, 'book')
  await mkdir(resolve(bookRoot, '大纲'), { recursive: true })
  await writeFile(resolve(bookRoot, '大纲', '卷纲_第一卷.md'), '# 第一卷\n章节范围:第1-8章\n## 本卷目标\n原文', 'utf8')
  const dbPath = resolve(dir, 'wb.sqlite')
  process.env.WORKBENCH_DB = dbPath
  const db = openDatabase(dbPath)
  const now = new Date().toISOString()
  db.prepare('INSERT INTO books (id, title, root_path) VALUES (?,?,?)').run('bk', 'T', bookRoot)
  db.prepare('INSERT INTO sessions (id, kind, book_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').run('se', 'agent', 'bk', 'running', now, now)
  const app = Fastify()
  await registerReviewCheckpointRoutes(app)
  return { app, db, bookRoot, volumePath: resolve(bookRoot, '大纲', '卷纲_第一卷.md') }
}
function mkCheckpoint(db: any, proposalText = `${MARK}\n- 旧钥匙未如期回收`) {
  return createVolumeReconcileCheckpoint(db, { sessionId: 'se', bookId: 'bk', payload: { volumeKey: '第一卷', proposalText } })
}

describe('resolve volume-reconcile', () => {
  it('apply appends proposalText (with anchor) to the volume file', async () => {
    const { app, db, volumePath } = await setup()
    const cp = mkCheckpoint(db)
    const res = await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'apply' } })
    expect(res.statusCode).toBe(200)
    const text = await readFile(volumePath, 'utf8')
    expect(text).toContain('原文') // original preserved
    expect(text).toContain(MARK)
    expect(text).toContain('旧钥匙未如期回收')
    expect(text).toContain('<!-- volume-reconcile:第一卷 -->')
  })

  it('apply-edited appends the edited text instead', async () => {
    const { app, db, volumePath } = await setup()
    const cp = mkCheckpoint(db)
    const editedText = `${MARK}\n- 我手改过的偏差`
    await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'apply-edited', editedText } })
    expect(await readFile(volumePath, 'utf8')).toContain('我手改过的偏差')
  })

  it('skip writes nothing and dismisses', async () => {
    const { app, db, volumePath } = await setup()
    const before = await readFile(volumePath, 'utf8')
    const cp = mkCheckpoint(db)
    await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'skip' } })
    expect(await readFile(volumePath, 'utf8')).toBe(before)
  })

  it('double apply appends only once', async () => {
    const { app, db, volumePath } = await setup()
    const cp = mkCheckpoint(db)
    await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'apply' } })
    const r2 = await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cp.id}/resolve`, payload: { action: 'apply' } })
    expect(r2.statusCode).toBe(409)
    const occurrences = (await readFile(volumePath, 'utf8')).split('<!-- volume-reconcile:第一卷 -->').length - 1
    expect(occurrences).toBe(1)
  })

  it('chapter-complete still rejects unknown volume actions (per-stage allowlist)', async () => {
    const { app, db } = await setup()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO chapters (id, book_id, chapter_number, title, source_path, stage) VALUES ('ch','bk',1,'第1章','/tmp/book/正文/第001章.md','已初稿')`).run()
    const { createReviewCheckpoint } = await import('../../src/db/repositories/review-checkpoints-repo')
    const cc = createReviewCheckpoint(db, { sessionId: 'se', bookId: 'bk', chapterId: 'ch', stage: 'chapter-complete', title: 't', summary: { completed: [], checks: [] }, changedFiles: [], options: ['accept'] })
    const res = await app.inject({ method: 'POST', url: `/api/review-checkpoints/${cc.id}/resolve`, payload: { action: 'apply' } })
    expect(res.statusCode).toBe(400)
  })
})
