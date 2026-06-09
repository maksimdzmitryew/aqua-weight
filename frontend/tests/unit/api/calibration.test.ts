import { describe, it, expect, vi, afterEach } from 'vitest'
import { calibrationApi } from '../../../src/api/calibration'
import { apiClient } from '../../../src/api/client'

describe('calibrationApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('list calls GET /plants/measurements/calibrating and forwards signal', async () => {
    const payload = [{ id: 'c1' }]
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce(payload as any)

    const ac = new AbortController()
    const res = await calibrationApi.list(ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants/measurements/calibrating', { signal: ac.signal })
    expect(res).toBe(payload)
  })

  it('correct posts to /plants/:plant_id/measurements/corrections with payload and signal', async () => {
    const created = { corrected: 2 }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(created as any)

    const ac = new AbortController()
    const body = { plant_id: 'p1', measurement_ids: ['m1', 'm2'] }
    const res = await calibrationApi.correct(body, { signal: ac.signal })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/corrections', { measurement_ids: ['m1', 'm2'] }, { signal: ac.signal })
    expect(res).toBe(created)
  })

  it('correct works when options are omitted (no signal passed)', async () => {
    const ok = { corrected: 0 }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(ok as any)

    const body = { plant_id: 'p1', measurement_ids: [] }
    const res = await calibrationApi.correct(body)

    expect(spy).toHaveBeenCalledTimes(1)
    // third argument should be an empty options object when none provided
    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/corrections', { measurement_ids: [] }, {})
    expect(res).toBe(ok)
  })

  it('correct throws when plant_id is missing', () => {
    expect(() => calibrationApi.correct({ measurement_ids: ['m1'] })).toThrow('Missing plant id')
  })
})
