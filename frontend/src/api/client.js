// Lightweight API client wrapper for fetch with base URL, JSON parsing,
// unified errors, retry for idempotent GETs, and optional cancellation.

const DEFAULT_BASE_URL = '/api'
const API_KEY = (import.meta.env && import.meta.env.VITE_API_KEY) || ''

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status || 0
    this.detail = options.detail || null
    this.body = options.body
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function normalizeSignal(signal) {
  if (!signal) return undefined
  const AbortSignalCtor = globalThis.AbortSignal
  if (typeof AbortSignalCtor === 'function' && signal instanceof AbortSignalCtor) {
    return signal
  }
  // Cross-realm AbortSignal (e.g., jsdom signal with undici fetch in Node) is incompatible.
  // Ignore it to avoid runtime TypeErrors in CI while preserving request behavior.
  return undefined
}

async function parseBody(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export class ApiClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, getHeaders } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getHeaders = typeof getHeaders === 'function' ? getHeaders : () => ({})
  }

  buildUrl(path) {
    if (!path) return this.baseUrl
    if (path.startsWith('http')) return path
    if (!path.startsWith('/')) path = '/' + path
    return this.baseUrl + path
  }

  async request(path, { method = 'GET', headers, body, signal, retry = undefined } = {}) {
    const isGet = method.toUpperCase() === 'GET'
    const attempts = typeof retry === 'number' ? retry + 1 : isGet ? 3 : 1
    const backoffMs = [0, 200, 500]

    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(backoffMs[Math.min(i, backoffMs.length - 1)])
      try {
        // Merge headers and ensure JSON content type when sending a body
        const mergedHeaders = {
          Accept: 'application/json, text/plain; q=0.8, */*; q=0.5',
          ...this.getHeaders(),
          ...headers,
        }
        if (API_KEY && !('X-API-Key' in mergedHeaders)) {
          mergedHeaders['X-API-Key'] = API_KEY
        }
        if (body != null && !('Content-Type' in mergedHeaders)) {
          mergedHeaders['Content-Type'] = 'application/json'
        }
        const normalizedSignal = normalizeSignal(signal)
        if (signal?.aborted && !normalizedSignal) {
          const abortErr = new Error('Aborted')
          abortErr.name = 'AbortError'
          throw abortErr
        }
        const requestInit = {
          method,
          headers: mergedHeaders,
          body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
          signal: normalizedSignal,
        }
        let res
        try {
          res = await fetch(this.buildUrl(path), requestInit)
        } catch (fetchErr) {
          const msg = fetchErr?.message || ''
          const incompatibleSignal = /expected signal.*instance of abortsignal/i.test(msg)
          if (requestInit.signal && incompatibleSignal) {
            // Fallback for cross-realm signal mismatch (jsdom AbortSignal with undici fetch).
            res = await fetch(this.buildUrl(path), { ...requestInit, signal: undefined })
          } else {
            throw fetchErr
          }
        }

        const data = await parseBody(res)
        if (!res.ok) {
          const detail =
            typeof data === 'object' && data && (data.detail || data.message)
              ? data.detail || data.message
              : typeof data === 'string'
                ? data
                : ''
          throw new ApiError(detail || `Request failed (HTTP ${res.status})`, {
            status: res.status,
            detail,
            body: data,
          })
        }
        return data
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        // Retry on network errors for GET
        const isNetworkErr = !(err instanceof ApiError)
        if (!(isGet && isNetworkErr) || i === attempts - 1) {
          if (err instanceof ApiError) throw err
          throw new ApiError(err?.message || 'Network error')
        } else {
          // Explicitly continue to next retry attempt to make branch coverage clear
          continue
        }
        /* c8 ignore next */
      }
      /* c8 ignore next */
    }
  }

  get(path, opts = {}) {
    return this.request(path, { ...opts, method: 'GET' })
  }
  post(path, body, opts = {}) {
    return this.request(path, { ...opts, method: 'POST', body })
  }
  put(path, body, opts = {}) {
    return this.request(path, { ...opts, method: 'PUT', body })
  }
  delete(path, opts = {}) {
    return this.request(path, { ...opts, method: 'DELETE' })
  }
}

export const apiClient = new ApiClient()
