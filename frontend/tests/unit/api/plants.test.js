import { describe, it, expect, vi, beforeEach } from 'vitest'
import { plantsApi } from '../../../src/api/plants'
import { apiClient, ApiError } from '../../../src/api/client'

vi.mock('../../../src/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class extends Error {
    constructor(message) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

describe('plantsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('list works with default params', async () => {
    await plantsApi.list()
    expect(apiClient.get).toHaveBeenCalledWith(
      '/plants?page=1&limit=20&status=active',
      expect.any(Object),
    )
  })

  it('list works with search and sort', async () => {
    await plantsApi.list({ search: ' fern ', sortBy: 'name', sortDir: 'asc' })
    expect(apiClient.get).toHaveBeenCalledWith(
      '/plants?page=1&limit=20&status=active&search=fern&sortBy=name&sortDir=asc',
      expect.any(Object),
    )
  })

  it('getByUuid throws if no uuid', () => {
    expect(() => plantsApi.getByUuid()).toThrow('Missing plant id')
  })

  it('duplicate throws if no uuid and works with uuid', async () => {
    expect(() => plantsApi.duplicate()).toThrow('Missing plant id')
    await plantsApi.duplicate('p1')
    expect(apiClient.post).toHaveBeenCalledWith('/plants/p1/duplicate', null, expect.any(Object))
  })

  it('update throws if no uuid', () => {
    expect(() => plantsApi.update()).toThrow('Missing plant id')
  })

  it('remove throws if no uuid', () => {
    expect(() => plantsApi.remove()).toThrow('Missing plant id')
  })

  it('getApproximation and getWeightApproximation work', async () => {
    await plantsApi.getApproximation()
    expect(apiClient.get).toHaveBeenCalledWith(
      '/plants/measurements/approximation/watering',
      expect.any(Object),
    )
    await plantsApi.getWeightApproximation()
    expect(apiClient.get).toHaveBeenCalledWith(
      '/plants/measurements/approximation/weight',
      expect.any(Object),
    )
  })
})
