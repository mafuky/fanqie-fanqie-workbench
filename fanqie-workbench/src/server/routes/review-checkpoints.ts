import { resolve as resolvePath, join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../../db/client.js'
import {
  getPendingReviewCheckpointBySessionId,
  getReviewCheckpointById,
  resolveReviewCheckpoint,
  type ReviewCheckpointOption,
} from '../../db/repositories/review-checkpoints-repo.js'
import { updateSessionStatus } from '../../db/repositories/sessions-repo.js'
import { getNextChapterId, startChapterActionSession } from '../chapter-action-service.js'

function getDatabasePath() {
  return process.env.WORKBENCH_DB || 'data/workbench.sqlite'
}

const CHAPTER_COMPLETE_ACTIONS: ReviewCheckpointOption[] = ['accept', 'deslop', 'rewrite', 'continue-next', 'save-only']
const VOLUME_RECONCILE_ACTIONS: ReviewCheckpointOption[] = ['apply', 'apply-edited', 'skip']

export async function registerReviewCheckpointRoutes(app: FastifyInstance) {
  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/review-checkpoint', async (request) => {
    const db = openDatabase(getDatabasePath())
    try {
      const checkpoint = getPendingReviewCheckpointBySessionId(db, request.params.sessionId)
      return { checkpoint }
    } finally {
      db.close()
    }
  })

  app.post<{
    Params: { checkpointId: string }
    Body: { action?: ReviewCheckpointOption; comment?: string; editedText?: string }
  }>('/api/review-checkpoints/:checkpointId/resolve', async (request, reply) => {
    const { action, comment } = request.body || {}
    if (!action) return reply.code(400).send({ error: 'action is required' })

    const db = openDatabase(getDatabasePath())
    try {
      const checkpoint = getReviewCheckpointById(db, request.params.checkpointId)
      if (!checkpoint) return reply.code(404).send({ error: 'checkpoint not found' })
      if (checkpoint.status !== 'pending') return reply.code(409).send({ error: 'checkpoint is not pending' })

      if (checkpoint.stage === 'volume-reconcile') {
        return await resolveVolumeReconcile(db, reply, checkpoint, action, request.body || {})
      }
      // chapter-complete path (existing behaviour):
      if (!CHAPTER_COMPLETE_ACTIONS.includes(action)) return reply.code(400).send({ error: 'unsupported review action' })
      if (!checkpoint.chapterId) return reply.code(400).send({ error: 'checkpoint has no chapter' })

      if (action === 'accept') {
        const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'accepted')
        updateSessionStatus(db, checkpoint.sessionId, 'succeeded')
        return { checkpoint: resolved }
      }

      if (action === 'save-only') {
        const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'dismissed')
        updateSessionStatus(db, checkpoint.sessionId, 'succeeded')
        return { checkpoint: resolved }
      }

      if (action === 'continue-next') {
        const currentChapter = db.prepare('SELECT chapter_number FROM chapters WHERE id = ? AND book_id = ?')
          .get(checkpoint.chapterId, checkpoint.bookId) as { chapter_number: number } | undefined
        if (!currentChapter) return reply.code(404).send({ error: 'chapter not found' })
        const nextChapterId = getNextChapterId(db, { bookId: checkpoint.bookId, chapterNumber: currentChapter.chapter_number })
        if (!nextChapterId) return reply.code(400).send({ error: '没有下一章，请先创建章节或选择其他操作' })

        const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'accepted')
        updateSessionStatus(db, checkpoint.sessionId, 'succeeded')
        const next = startChapterActionSession({
          db,
          databasePath: getDatabasePath(),
          actionKey: 'chapter.continue',
          bookId: checkpoint.bookId,
          chapterId: nextChapterId,
        })
        return { checkpoint: resolved, session: next.session }
      }

      const actionKey = action === 'deslop' ? 'chapter.deslop' : 'chapter.rewrite'
      const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'resolved-action')
      updateSessionStatus(db, checkpoint.sessionId, 'succeeded')
      const next = startChapterActionSession({
        db,
        databasePath: getDatabasePath(),
        actionKey,
        bookId: checkpoint.bookId,
        chapterId: checkpoint.chapterId,
        userHint: comment,
      })
      return { checkpoint: resolved, session: next.session }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'chapter not found') return reply.code(404).send({ error: message })
      return reply.code(400).send({ error: message })
    } finally {
      db.close()
    }
  })
}

async function resolveVolumeReconcile(
  db: ReturnType<typeof openDatabase>,
  reply: any,
  checkpoint: NonNullable<ReturnType<typeof getReviewCheckpointById>>,
  action: ReviewCheckpointOption,
  body: { editedText?: string },
) {
  if (!VOLUME_RECONCILE_ACTIONS.includes(action)) return reply.code(400).send({ error: 'unsupported review action' })
  if (action === 'skip') {
    const resolved = resolveReviewCheckpoint(db, checkpoint.id, 'dismissed')
    return { checkpoint: resolved }
  }
  const payload = checkpoint.payload
  if (!payload) return reply.code(400).send({ error: 'checkpoint has no payload' })
  const text = action === 'apply-edited' ? (body.editedText ?? '') : payload.proposalText
  if (!text.trim()) return reply.code(400).send({ error: 'editedText is required for apply-edited' })

  // Resolve the target path from the trusted book root — never from payload.
  const book = db.prepare('SELECT root_path FROM books WHERE id = ?').get(checkpoint.bookId) as { root_path: string } | undefined
  if (!book) return reply.code(404).send({ error: 'book not found' })
  const volumeNumberLabel = payload.volumeKey.replace(/^第/, '').replace(/卷$/, '')
  const target = resolvePath(book.root_path, '大纲', `卷纲_第${volumeNumberLabel}卷.md`)
  const allowedRoot = resolvePath(book.root_path, '大纲')
  if (!target.startsWith(allowedRoot + '/') && target !== join(allowedRoot, `卷纲_第${volumeNumberLabel}卷.md`)) {
    return reply.code(400).send({ error: 'target path escapes book outline dir' })
  }

  // Transactional claim: only the first resolver flips pending→accepted and writes.
  const claim = db.prepare("UPDATE review_checkpoints SET status='accepted', resolved_at=? WHERE id=? AND status='pending'")
  const claimed = db.transaction((id: string) => claim.run(new Date().toISOString(), id).changes)(checkpoint.id)
  if (claimed === 0) return reply.code(409).send({ error: 'checkpoint already resolved' })

  const anchor = `<!-- volume-reconcile:${payload.volumeKey} -->`
  const existing = await readFile(target, 'utf8').catch(() => '')
  const block = text.includes(anchor) ? text : text.replace(/\n/, `\n${anchor}\n`)
  await writeFile(target, `${existing.replace(/\s*$/, '')}\n\n${block}\n`, 'utf8')

  if (payload.arcNote) {
    const arcCandidates = ['总纲.md', '大纲.md'].map((n) => resolvePath(book.root_path, '大纲', n))
    for (const ap of arcCandidates) {
      const cur = await readFile(ap, 'utf8').catch(() => null)
      if (cur == null) continue
      await writeFile(ap, `${cur.replace(/\s*$/, '')}\n\n## 对账记录\n${anchor}\n- ${payload.arcNote}\n`, 'utf8')
      break
    }
  }
  return { checkpoint: getReviewCheckpointById(db, checkpoint.id) }
}
