import { afterEach, describe, expect, it, vi } from 'vitest'

const mockWrite = vi.fn()
const mockKill = vi.fn()
const mockResize = vi.fn()
const mockOnData = vi.fn()
const mockOnExit = vi.fn()

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: (cb: (data: string) => void) => { mockOnData.mockImplementation(cb); return { dispose: vi.fn() } },
    onExit: (cb: (e: { exitCode: number }) => void) => { mockOnExit.mockImplementation(cb); return { dispose: vi.fn() } },
    write: mockWrite,
    kill: mockKill,
    resize: mockResize,
    pid: 12345,
  })),
}))

import { createPtyManager } from '../../src/claude/pty-manager.js'

describe('PtyManager', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('spawns a PTY session for a bookId', async () => {
    const manager = createPtyManager({ projectRoot: '/tmp' })
    const session = await manager.spawn('book-1')
    expect(session.id).toBe('book-1')
    expect(session.status).toBe('starting')
    const pty = await import('node-pty')
    expect(pty.spawn).toHaveBeenCalledWith(
      'claude',
      ['--permission-mode', 'bypassPermissions'],
      expect.objectContaining({ cwd: '/tmp', cols: 120, rows: 40 }),
    )
  })

  it('writes data to PTY', async () => {
    const manager = createPtyManager({ projectRoot: '/tmp' })
    await manager.spawn('book-1')
    manager.write('book-1', 'hello\n')
    expect(mockWrite).toHaveBeenCalledWith('hello\n')
  })

  it('kills a PTY session', async () => {
    const manager = createPtyManager({ projectRoot: '/tmp' })
    await manager.spawn('book-1')
    manager.kill('book-1')
    expect(mockKill).toHaveBeenCalled()
    expect(manager.getSession('book-1')).toBeNull()
  })

  it('emits output events from PTY data', async () => {
    const manager = createPtyManager({ projectRoot: '/tmp' })
    const session = await manager.spawn('book-1')
    const chunks: string[] = []
    session.emitter.on('output', (data: string) => chunks.push(data))
    mockOnData('hello world')
    expect(chunks).toEqual(['hello world'])
  })

  it('emits exit event when PTY exits', async () => {
    const manager = createPtyManager({ projectRoot: '/tmp' })
    const session = await manager.spawn('book-1')
    const exits: number[] = []
    session.emitter.on('exit', (code: number) => exits.push(code))
    mockOnExit({ exitCode: 0 })
    expect(exits).toEqual([0])
  })

  it('sends arrow key sequences', async () => {
    const manager = createPtyManager({ projectRoot: '/tmp' })
    await manager.spawn('book-1')
    manager.sendKeys('book-1', ['Down', 'Down', 'Enter'])
    expect(mockWrite).toHaveBeenCalledWith('\x1b[B')
    expect(mockWrite).toHaveBeenCalledWith('\r')
  })

  it('throws when writing to nonexistent session', () => {
    const manager = createPtyManager({ projectRoot: '/tmp' })
    expect(() => manager.write('no-such', 'x')).toThrow('no PTY session')
  })
})
