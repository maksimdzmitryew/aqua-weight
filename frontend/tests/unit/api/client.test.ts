import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiClient, ApiError, apiClient } from '../../../src/api/client'

// Helper to create a minimal fetch-like response
function makeResponse({ ok = true, status = 200, body = '' }: { ok?: boolean; status?: number; body?: any }) {
  return {
    ok,
    status,
    async text() {
      if (typeof body === 'string') return body
      if (body == null) return ''
      return JSON.stringify(body)
    },
  } as unknown as Response
}

describe('ApiError', () => {
  it('stores status, detail and body', () => {
    const err = new ApiError('Boom', { status: 418, detail: 'teapot', body: { a: 1 } })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ApiError')
    expect(err.message).toBe('Boom')
    expect(err.status).toBe(418)
    expect(err.detail).toBe('teapot')
    expect(err.body).toEqual({ a: 1 })
  })
})

describe('ApiClient.buildUrl', () => {
  it('builds URLs with default base and various inputs', () => {
    const c = new ApiClient()
    expect(c.buildUrl('')).toBe('/api')
    expect(c.buildUrl(undefined as unknown as string)).toBe('/api')
    expect(c.buildUrl('plants')).toBe('/api/plants')
    expect(c.buildUrl('/plants')).toBe('/api/plants')
    expect(c.buildUrl('http://x/plants')).toBe('http://x/plants')
  })

  it('respects custom baseUrl without trailing slash', () => {
    const c = new ApiClient({ baseUrl: '/api/' })
    expect(c.baseUrl).toBe('/api')
    expect(c.buildUrl('/x')).toBe('/api/x')
  })
})

describe('ApiClient.request success paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed JSON on success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(makeResponse({ body: { ok: 1 } }))
    const c = new ApiClient()
    const data = await c.request('/ping')
    expect(data).toEqual({ ok: 1 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns string when response is plain text', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(makeResponse({ body: 'hello' }))
    const c = new ApiClient()
    const data = await c.get('/text')
    expect(data).toBe('hello')
  })

  it('returns null for empty body', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(makeResponse({ body: '' }))
    const c = new ApiClient()
    const data = await c.get('/empty')
    expect(data).toBeNull()
  })
})

describe('ApiClient.request error mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws ApiError with JSON detail', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(
      makeResponse({ ok: false, status: 400, body: { detail: 'bad' } }),
    )
    const c = new ApiClient()
    await expect(c.get('/oops')).rejects.toMatchObject({ name: 'ApiError', status: 400, detail: 'bad' })
  })

  it('throws ApiError with JSON message', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(
      makeResponse({ ok: false, status: 422, body: { message: 'nope' } }),
    )
    const c = new ApiClient()
    await expect(c.get('/nope')).rejects.toMatchObject({ name: 'ApiError', status: 422, detail: 'nope' })
  })

  it('throws ApiError with plain text message', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(
      makeResponse({ ok: false, status: 500, body: 'server exploded' }),
    )
    const c = new ApiClient()
    await expect(c.get('/boom')).rejects.toMatchObject({ name: 'ApiError', status: 500, detail: 'server exploded' })
  })

  it('uses default message when body is object without detail/message', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(
      makeResponse({ ok: false, status: 404, body: { error: 'not used' } }),
    )
    const c = new ApiClient()
    try {
      await c.get('/no-detail')
      throw new Error('should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiError)
      expect(e.status).toBe(404)
      // ApiError constructor normalizes falsy detail to null
      expect(e.detail).toBeNull()
      expect(e.message).toBe('Request failed (HTTP 404)')
      expect(e.body).toEqual({ error: 'not used' })
    }
  })

  it('uses default message when body is empty (null)', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(
      makeResponse({ ok: false, status: 401, body: '' }),
    )
    const c = new ApiClient()
    await expect(c.get('/empty-body')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      detail: null,
      message: 'Request failed (HTTP 401)',
    })
  })

  it('wraps network error without message using default text', async () => {
    // One attempt only so we hit the final throw path
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue({})
    const c = new ApiClient()
    await expect(c.get('/no-message', { retry: 0 })).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: 'Network error',
    })
  })

  it('wraps network error and preserves original error message when present', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new Error('connection lost'))
    const c = new ApiClient()
    await expect(c.get('/with-message', { retry: 0 })).rejects.toMatchObject({
      name: 'ApiError',
      message: 'connection lost',
    })
  })
})

describe('retry logic and abort handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries GET on network errors and eventually succeeds', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockRejectedValueOnce(new TypeError('net'))
      .mockRejectedValueOnce(new TypeError('net2'))
      .mockResolvedValueOnce(makeResponse({ body: { ok: true } }))

    const c = new ApiClient()
    const p = c.get('/retry', { retry: 2 })
    // Run all scheduled timers (0ms, 200ms, 500ms backoffs)
    await vi.runAllTimersAsync()
    const data = await p
    expect(data).toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('retries GET with default retry policy (implicit) and succeeds on second attempt', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockRejectedValueOnce(new TypeError('flaky'))
      .mockResolvedValueOnce(makeResponse({ body: { ok: true } }))

    const c = new ApiClient()
    const p = c.get('/retry-default')
    await vi.runAllTimersAsync()
    const data = await p
    expect(data).toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries GET after network error, then fails with HTTP error (ApiError)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockRejectedValueOnce(new TypeError('net'))
      .mockResolvedValueOnce(makeResponse({ ok: false, status: 503, body: 'unavailable' }))

    const c = new ApiClient()
    const p = c.get('/retry-then-http', { retry: 2 }).catch((e) => e)
    await vi.runAllTimersAsync()
    const err = await p
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(503)
    expect(err.detail).toBe('unavailable')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('stops retrying when attempts exhausted and wraps network error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockRejectedValue(new TypeError('down'))

    const c = new ApiClient()
    // Attach a catch handler immediately to avoid unhandled rejection warnings
    const p = c.get('/fail', { retry: 1 }).catch((e) => e) // 2 attempts total
    await vi.runAllTimersAsync()
    const err = await p
    expect(err).toBeInstanceOf(ApiError)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not retry for non-GET methods', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new TypeError('down'))
    const c = new ApiClient()
    await expect(c.post('/no-retry', { a: 1 })).rejects.toBeInstanceOf(ApiError)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('propagates AbortError without wrapping', async () => {
    const abortErr = new Error('aborted')
    ;(abortErr as any).name = 'AbortError'
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(abortErr)
    const c = new ApiClient()
    await expect(c.get('/abort')).rejects.toBe(abortErr)
  })

  it('does not retry when the error is ApiError (HTTP error), even if retry is set', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeResponse({ ok: false, status: 429, body: { detail: 'rate' } }))
    const c = new ApiClient()
    await expect(c.get('/http-error-no-retry', { retry: 2 })).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      detail: 'rate',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('headers and helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges Accept, getHeaders and per-request headers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(makeResponse({ body: null }))
    const c = new ApiClient({ getHeaders: () => ({ Authorization: 'Bearer t' }) })
    await c.request('/h', { headers: { 'X-Req': '1' } })
    const passedInit = fetchSpy.mock.calls[0][1] as RequestInit
    expect((passedInit.headers as Record<string, string>).Accept).toBeDefined()
    expect((passedInit.headers as any).Authorization).toBe('Bearer t')
    expect((passedInit.headers as any)['X-Req']).toBe('1')
  })

  it('serializes object body and passes string body as-is', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(makeResponse({ body: null }))
    const c = new ApiClient()
    await c.post('/p', { a: 1 })
    await c.put('/u', '{"b":2}')
    expect((fetchSpy.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ a: 1 }))
    expect((fetchSpy.mock.calls[1][1] as RequestInit).body).toBe('{"b":2}')
  })

  it('convenience methods delegate to request with proper method', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(makeResponse({ body: null }))
    const c = new ApiClient()
    await c.get('/g')
    await c.post('/p', { x: 1 })
    await c.put('/u', { y: 2 })
    await c.delete('/d')
    const methods = fetchSpy.mock.calls.map(([, init]) => (init as RequestInit).method)
    expect(methods).toEqual(['GET', 'POST', 'PUT', 'DELETE'])
  })

  it('exported singleton apiClient works with default base url', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(makeResponse({ body: { pong: 1 } }))
    const data = await apiClient.get('ping') // relative without leading slash
    expect(data).toEqual({ pong: 1 })
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/ping')
  })
})
