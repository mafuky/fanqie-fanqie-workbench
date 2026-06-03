import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client'
import { reconcileStaleAgentSessions } from '../../src/db/repositories/sessions-repo'
import { ensureAgentSessionRow, wireSessionStatusOnDone } from '../../src/server/routes/agent-sessions'

async function db() {
  const dir = await mkdtemp(resolve(tmpdir(), 'wb-asl-'))
  const d = openDatabase(resolve(dir, 'wb.sqlite'))
  d.prepare('INSERT INTO books (id, title, root_path) VALUES (?,?,?)').run('bk', 'T', '/tmp/bk')
  return d
}

describe('reconcileStaleAgentSessions', () => {
  it('marks non-terminal kind=agent sessions failed, leaving others alone', async () => {
    const d = await db()
    const now = new Date().toISOString()
    const ins = d.prepare('INSERT INTO sessions (id, kind, book_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    ins.run('a-run', 'agent', 'bk', 'running', now, now)        // stale → failed
    ins.run('a-done', 'agent', 'bk', 'succeeded', now, now)     // terminal → untouched
    ins.run('entry', 'book-entry', 'bk', 'running', now, now)   // other kind → untouched

    const changed = reconcileStaleAgentSessions(d)
    expect(changed).toBe(1)
    expect((d.prepare('SELECT status FROM sessions WHERE id=?').get('a-run') as any).status).toBe('failed')
    expect((d.prepare('SELECT status FROM sessions WHERE id=?').get('a-done') as any).status).toBe('succeeded')
    expect((d.prepare('SELECT status FROM sessions WHERE id=?').get('entry') as any).status).toBe('running')
    d.close()
  })
})

describe('wireSessionStatusOnDone', () => {
  it('transitions the session to succeeded/failed on the done event', async () => {
    const d = await db()
    ensureAgentSessionRow(d, { sessionId: 's-ok', bookId: 'bk', chapterId: null })
    ensureAgentSessionRow(d, { sessionId: 's-fail', bookId: 'bk', chapterId: null })

    const okEmitter = new EventEmitter()
    wireSessionStatusOnDone(d, okEmitter, 's-ok')
    okEmitter.emit('event', { type: 'done', status: 'succeeded' })
    expect((d.prepare('SELECT status FROM sessions WHERE id=?').get('s-ok') as any).status).toBe('succeeded')

    const failEmitter = new EventEmitter()
    wireSessionStatusOnDone(d, failEmitter, 's-fail')
    failEmitter.emit('event', { type: 'done', status: 'failed' })
    expect((d.prepare('SELECT status FROM sessions WHERE id=?').get('s-fail') as any).status).toBe('failed')
    d.close()
  })

  it('ignores non-done events', async () => {
    const d = await db()
    ensureAgentSessionRow(d, { sessionId: 's-run', bookId: 'bk', chapterId: null })
    const emitter = new EventEmitter()
    wireSessionStatusOnDone(d, emitter, 's-run')
    emitter.emit('event', { type: 'phase-start', phase: 'load-context' })
    expect((d.prepare('SELECT status FROM sessions WHERE id=?').get('s-run') as any).status).toBe('running')
    d.close()
  })
})
