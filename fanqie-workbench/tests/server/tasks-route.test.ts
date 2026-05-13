import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/server/app'

describe('tasks route', () => {
  it('accepts a draft-chapter request', async () => {
    const app = await buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { type: 'draft-chapter', bookId: 'b1', chapterId: 'c1' }
    })

    expect(response.statusCode).toBe(202)
    await app.close()
  })
})
