import { describe, it, expect, vi, afterEach } from 'vitest'
import { measurementsApi } from '../../../src/api/measurements'
import { apiClient, ApiError } from '../../../src/api/client'

describe('measurementsApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('listByPlant throws ApiError when plant uuid missing', () => {
    expect(() => measurementsApi.listByPlant('' as unknown as string, undefined as any)).toThrow(
      ApiError,
    )
    try {
      measurementsApi.listByPlant('' as unknown as string, undefined as any)
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiError)
      expect(e.message).toBe('Missing plant id')
    }
  })

  it('listByPlant calls GET /plants/:uuid/measurements and forwards signal', async () => {
    const payload = [{ id: 'm1' }]
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce(payload as any)

    const ac = new AbortController()
    const res = await measurementsApi.listByPlant('abc-123', ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants/abc-123/measurements', { signal: ac.signal })
    expect(res).toBe(payload)
  })

  it('getById throws when plantId missing and calls GET /plants/:plantId/measurements/:id otherwise', async () => {
    expect(() => measurementsApi.getById('' as unknown as string, undefined as any)).toThrow(
      ApiError,
    )
    expect(() => measurementsApi.getById('p1', '' as unknown as string)).toThrow(ApiError)

    const item = { id: 'm2' }
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce(item as any)

    const ac = new AbortController()
    const res = await measurementsApi.getById('p1', 'm2', ac.signal)
    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/m2', { signal: ac.signal })
    expect(res).toBe(item)
  })

  it('delete throws when plantId missing and calls DELETE /plants/:plantId/measurements/:id otherwise', async () => {
    expect(() => measurementsApi.delete('' as unknown as string, undefined as any)).toThrow(
      ApiError,
    )
    expect(() => measurementsApi.delete('p1', '' as unknown as string)).toThrow(ApiError)

    const ok = { removed: 1 }
    const spy = vi.spyOn(apiClient, 'delete').mockResolvedValueOnce(ok as any)

    const ac = new AbortController()
    const res = await measurementsApi.delete('p1', 'mid-1', ac.signal)
    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/mid-1', { signal: ac.signal })
    expect(res).toBe(ok)
  })

  it('weight.create posts JSON body with headers and signal', async () => {
    const created = { id: 'w1' }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(created as any)

    const ac = new AbortController()
    const body = { plant_id: 'p1', grams: 123 }
    const res = await measurementsApi.weight.create('p1', body, ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/weight', { grams: 123 }, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(created)
  })

  it('weight.update throws on missing id and sends PUT with headers and signal', async () => {
    expect(() =>
      measurementsApi.weight.update('' as unknown as string, '' as unknown as string, { grams: 1 }, undefined as any),
    ).toThrow(ApiError)

    const updated = { id: 'w2', grams: 200 }
    const spy = vi.spyOn(apiClient, 'put').mockResolvedValueOnce(updated as any)

    const ac = new AbortController()
    const body = { grams: 200 }
    const res = await measurementsApi.weight.update('p1', 'w2', body, ac.signal)

    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/weight/w2', body, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(updated)
  })

  it('watering.create posts JSON body with headers and signal', async () => {
    const created = { id: 'wa1' }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(created as any)

    const ac = new AbortController()
    const body = { plant_id: 'p1', ml: 500 }
    const res = await measurementsApi.watering.create('p1', body, ac.signal)

    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/watering', { ml: 500 }, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(created)
  })

  it('watering.update throws on missing id and sends PUT with headers and signal', async () => {
    expect(() =>
      measurementsApi.watering.update('' as unknown as string, '' as unknown as string, { ml: 1 }, undefined as any),
    ).toThrow(ApiError)

    const updated = { id: 'wa2', ml: 600 }
    const spy = vi.spyOn(apiClient, 'put').mockResolvedValueOnce(updated as any)

    const ac = new AbortController()
    const body = { ml: 600 }
    const res = await measurementsApi.watering.update('p1', 'wa2', body, ac.signal)

    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/watering/wa2', body, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(updated)
  })

  it('repotting.get throws on missing id and calls GET /plants/:plantId/measurements/:id otherwise', async () => {
    expect(() => measurementsApi.repotting.get('' as unknown as string, undefined as any)).toThrow(
      ApiError,
    )
    expect(() => measurementsApi.repotting.get('p1', '' as unknown as string)).toThrow(ApiError)

    const item = { id: 'r1' }
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce(item as any)

    const ac = new AbortController()
    const res = await measurementsApi.repotting.get('p1', 'r1', ac.signal)

    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/r1', { signal: ac.signal })
    expect(res).toBe(item)
  })

  it('repotting.create posts with headers and signal', async () => {
    const created = { id: 'r2' }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(created as any)

    const ac = new AbortController()
    const body = { plant_id: 'p1', pot_size: 'M' }
    const res = await measurementsApi.repotting.create('p1', body, ac.signal)

    expect(spy).toHaveBeenCalledWith('/plants/p1/repotting', { pot_size: 'M' }, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(created)
  })

  it('repotting.update throws on missing id and sends PUT with headers and signal', async () => {
    expect(() =>
      measurementsApi.repotting.update(
        '' as unknown as string,
        '' as unknown as string,
        { pot_size: 'L' },
        undefined as any,
      ),
    ).toThrow(ApiError)

    const updated = { id: 'r3', pot_size: 'L' }
    const spy = vi.spyOn(apiClient, 'put').mockResolvedValueOnce(updated as any)

    const ac = new AbortController()
    const body = { pot_size: 'L' }
    const res = await measurementsApi.repotting.update('p1', 'r3', body, ac.signal)

    expect(spy).toHaveBeenCalledWith('/plants/p1/repotting/r3', body, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(updated)
  })

  it('watering.createVacation posts JSON body with headers and signal', async () => {
    const created = { id: 'v1' }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(created as any)

    const ac = new AbortController()
    const body = { plant_id: 'p1' }
    const res = await measurementsApi.watering.createVacation('p1', body, ac.signal)

    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/vacation/watering', {}, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(created)
  })

  it('watering.create with mode posts to url with ?mode param', async () => {
    const created = { id: 'wa-mode' }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(created as any)

    const ac = new AbortController()
    const body = { plant_id: 'p1', ml: 500 }
    const mode = 'bulk'
    const res = await measurementsApi.watering.create('p1', body, ac.signal, mode)

    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/watering?mode=bulk', { ml: 500 }, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(created)
  })

  it('watering.update with mode sends PUT to url with ?mode param', async () => {
    const updated = { id: 'wa-mode-2', ml: 600 }
    const spy = vi.spyOn(apiClient, 'put').mockResolvedValueOnce(updated as any)

    const ac = new AbortController()
    const body = { ml: 600 }
    const id = 'wa-mode-2'
    const mode = 'bulk'
    const res = await measurementsApi.watering.update('p1', id, body, ac.signal, mode)

    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/watering/wa-mode-2?mode=bulk', body, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(updated)
  })

  it('weight.create with mode posts to url with ?mode param', async () => {
    const created = { id: 'w-mode' }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(created as any)

    const ac = new AbortController()
    const body = { plant_id: 'p1', grams: 123 }
    const mode = 'bulk'
    const res = await measurementsApi.weight.create('p1', body, ac.signal, mode)

    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/weight?mode=bulk', { grams: 123 }, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(created)
  })

  it('weight.update with mode sends PUT to url with ?mode param', async () => {
    const updated = { id: 'w-mode-2', grams: 200 }
    const spy = vi.spyOn(apiClient, 'put').mockResolvedValueOnce(updated as any)

    const ac = new AbortController()
    const body = { grams: 200 }
    const id = 'w-mode-2'
    const mode = 'bulk'
    const res = await measurementsApi.weight.update('p1', id, body, ac.signal, mode)

    expect(spy).toHaveBeenCalledWith('/plants/p1/measurements/weight/w-mode-2?mode=bulk', body, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(updated)
  })
})
