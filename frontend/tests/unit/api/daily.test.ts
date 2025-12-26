import { describe, it, expect, vi, afterEach } from 'vitest'
import { dailyApi } from '../../../src/api/daily'
import { apiClient } from '../../../src/api/client'

describe('dailyApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('list calls apiClient.get with /daily and forwards signal, returning data', async () => {
    const payload = [{ id: 1 }, { id: 2 }]
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce(payload as any)

    const ac = new AbortController()
    const res = await dailyApi.list(ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/daily', { signal: ac.signal })
    expect(res).toBe(payload)
  })
})
