import { describe, it, expect, vi, afterEach } from 'vitest'
import { locationsApi } from '../../../src/api/locations'
import { apiClient, ApiError } from '../../../src/api/client'

describe('locationsApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('list calls apiClient.get with /locations and forwards signal, returning data', async () => {
    const payload = [{ id: 'loc-1' }]
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce(payload as any)

    const ac = new AbortController()
    const res = await locationsApi.list(ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/locations', { signal: ac.signal })
    expect(res).toBe(payload)
  })

  it('create posts JSON payload with proper headers and forwards signal', async () => {
    const created = { id: 'loc-2', name: 'North' }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(created as any)

    const ac = new AbortController()
    const body = { name: 'North' }
    const res = await locationsApi.create(body, ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/locations', body, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(created)
  })

  it('updateByName throws ApiError when name missing', () => {
    expect(() => locationsApi.updateByName('Original', '' as unknown as string, undefined as any)).toThrow(ApiError)
    try {
      locationsApi.updateByName('Original', '' as unknown as string, undefined as any)
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiError)
      expect(e.message).toBe('Name is required')
    }
  })

  it('updateByName sends PUT with original_name and name, headers and signal', async () => {
    const updated = { ok: true }
    const spy = vi.spyOn(apiClient, 'put').mockResolvedValueOnce(updated as any)

    const ac = new AbortController()
    const res = await locationsApi.updateByName('Old', 'New', ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/locations/by-name', { original_name: 'Old', name: 'New' }, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(updated)
  })

  it('remove throws ApiError when uuid missing', () => {
    expect(() => locationsApi.remove('' as unknown as string, undefined as any)).toThrow(ApiError)
    try {
      locationsApi.remove('' as unknown as string, undefined as any)
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiError)
      expect(e.message).toBe('Missing location id')
    }
  })

  it('remove calls DELETE with /locations/:uuid and forwards signal', async () => {
    const ok = { removed: 1 }
    const spy = vi.spyOn(apiClient, 'delete').mockResolvedValueOnce(ok as any)

    const ac = new AbortController()
    const res = await locationsApi.remove('abc-123', ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/locations/abc-123', { signal: ac.signal })
    expect(res).toBe(ok)
  })

  it('reorder sends PUT to /locations/order with ordered_ids and headers, forwards signal', async () => {
    const ok = { order: 'ok' }
    const spy = vi.spyOn(apiClient, 'put').mockResolvedValueOnce(ok as any)

    const ac = new AbortController()
    const ids = ['a', 'b', 'c']
    const res = await locationsApi.reorder(ids, ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/locations/order', { ordered_ids: ids }, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(ok)
  })
})
