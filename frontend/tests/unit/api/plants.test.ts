import { describe, it, expect, vi, afterEach } from 'vitest'
import { plantsApi } from '../../../src/api/plants'
import { apiClient, ApiError } from '../../../src/api/client'

describe('plantsApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('list calls apiClient.get with /plants and forwards signal, returning data', async () => {
    const payload = [{ uuid: 'p1' }]
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce(payload as any)

    const ac = new AbortController()
    const res = await plantsApi.list(ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants', { signal: ac.signal })
    expect(res).toBe(payload)
  })

  it('getByUuid throws ApiError when uuid missing', () => {
    expect(() => plantsApi.getByUuid('' as unknown as string, undefined as any)).toThrow(ApiError)
    try {
      plantsApi.getByUuid('' as unknown as string, undefined as any)
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiError)
      expect(e.message).toBe('Missing plant id')
    }
  })

  it('getByUuid calls apiClient.get with /plants/:uuid and forwards signal', async () => {
    const plant = { uuid: 'abc', name: 'Ficus' }
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce(plant as any)

    const ac = new AbortController()
    const res = await plantsApi.getByUuid('abc', ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants/abc', { signal: ac.signal })
    expect(res).toBe(plant)
  })

  it('create posts JSON payload with proper headers and forwards signal', async () => {
    const created = { uuid: 'p2', name: 'Monstera' }
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce(created as any)

    const ac = new AbortController()
    const body = { name: 'Monstera' }
    const res = await plantsApi.create(body, ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants', body, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(created)
  })

  it('update throws ApiError when uuid missing', () => {
    expect(() => plantsApi.update('' as unknown as string, { name: 'x' }, undefined as any)).toThrow(ApiError)
    try {
      plantsApi.update('' as unknown as string, { name: 'x' }, undefined as any)
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiError)
      expect(e.message).toBe('Missing plant id')
    }
  })

  it('update sends PUT with payload, headers and signal', async () => {
    const updated = { ok: true }
    const spy = vi.spyOn(apiClient, 'put').mockResolvedValueOnce(updated as any)

    const ac = new AbortController()
    const res = await plantsApi.update('abc', { name: 'New' }, ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants/abc', { name: 'New' }, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(updated)
  })

  it('reorder sends PUT to /plants/order with ordered_ids and headers, forwards signal', async () => {
    const ok = { order: 'ok' }
    const spy = vi.spyOn(apiClient, 'put').mockResolvedValueOnce(ok as any)

    const ac = new AbortController()
    const ids = ['a', 'b', 'c']
    const res = await plantsApi.reorder(ids, ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants/order', { ordered_ids: ids }, {
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
    })
    expect(res).toBe(ok)
  })

  it('remove throws ApiError when uuid missing', () => {
    expect(() => plantsApi.remove('' as unknown as string, undefined as any)).toThrow(ApiError)
    try {
      plantsApi.remove('' as unknown as string, undefined as any)
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiError)
      expect(e.message).toBe('Missing plant id')
    }
  })

  it('remove calls DELETE with /plants/:uuid and forwards signal', async () => {
    const ok = { removed: 1 }
    const spy = vi.spyOn(apiClient, 'delete').mockResolvedValueOnce(ok as any)

    const ac = new AbortController()
    const res = await plantsApi.remove('abc-123', ac.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/plants/abc-123', { signal: ac.signal })
    expect(res).toBe(ok)
  })
})
