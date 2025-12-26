// Lightweight API client wrapper for fetch with base URL, JSON parsing,
// unified errors, retry for idempotent GETs, and optional cancellation.

const DEFAULT_BASE_URL = '/api'

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status || 0
    this.detail = options.detail || null
    this.body = options.body
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function parseBody(res) {
  const text = await res.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
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
    const attempts = typeof retry === 'number' ? retry + 1 : (isGet ? 3 : 1)
    const backoffMs = [0, 200, 500]

    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(backoffMs[Math.min(i, backoffMs.length - 1)])
      try {
        // Merge headers and ensure JSON content type when sending a body
        const mergedHeaders = {
          'Accept': 'application/json, text/plain; q=0.8, */*; q=0.5',
          ...this.getHeaders(),
          ...headers,
        }
        if (body != null && !('Content-Type' in mergedHeaders)) {
          mergedHeaders['Content-Type'] = 'application/json'
        }
        const res = await fetch(this.buildUrl(path), {
          method,
          headers: mergedHeaders,
          body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
          signal,
        })

        const data = await parseBody(res)
        if (!res.ok) {
          const detail = typeof data === 'object' && data && (data.detail || data.message) ? (data.detail || data.message) : (typeof data === 'string' ? data : '')
          throw new ApiError(detail || `Request failed (HTTP ${res.status})`, { status: res.status, detail, body: data })
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

  get(path, opts = {}) { return this.request(path, { ...opts, method: 'GET' }) }
  post(path, body, opts = {}) { return this.request(path, { ...opts, method: 'POST', body }) }
  put(path, body, opts = {}) { return this.request(path, { ...opts, method: 'PUT', body }) }
  delete(path, opts = {}) { return this.request(path, { ...opts, method: 'DELETE' }) }
}

export const apiClient = new ApiClient()