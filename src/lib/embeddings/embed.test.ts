import { beforeEach, describe, expect, it, vi } from 'vitest'
import { embedMany } from '../braintrust-ai'
import { embedQueries, resetQueryEmbeddingCache } from './embed'

vi.mock('../braintrust-ai', () => ({
  embedMany: vi.fn(),
}))

const mockedEmbedMany = vi.mocked(embedMany)

describe('embedQueries cache', () => {
  beforeEach(() => {
    resetQueryEmbeddingCache()
    mockedEmbedMany.mockReset()
  })

  it('dedupes duplicate strings within a batch', async () => {
    mockedEmbedMany.mockResolvedValue({
      embeddings: [[1], [2]],
    } as never)

    const out = await embedQueries(['Milk', 'milk ', 'rice'])

    expect(mockedEmbedMany).toHaveBeenCalledTimes(1)
    expect(mockedEmbedMany.mock.calls[0]?.[0]).toMatchObject({
      values: ['Milk', 'rice'],
    })
    expect(out).toEqual([[1], [1], [2]])
  })

  it('shares in-flight embeddings across concurrent calls', async () => {
    mockedEmbedMany.mockResolvedValue({
      embeddings: [[1], [2]],
    } as never)

    const [a, b] = await Promise.all([
      embedQueries(['00 flour', 'rice']),
      embedQueries(['00 Flour ', 'rice']),
    ])

    expect(mockedEmbedMany).toHaveBeenCalledTimes(1)
    expect(a).toEqual([[1], [2]])
    expect(b).toEqual([[1], [2]])
  })
})
