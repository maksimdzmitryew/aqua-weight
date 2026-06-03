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
  constructor({ baseUrl = DEFAULT_BASE_URL, getHeaders, apiVersion } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiVersion = apiVersion
    this.getHeaders = typeof getHeaders === 'function' ? getHeaders : () => ({})
    this.getAccessToken = null
    this.getDeviceId = null
    this.onAccessTokenUpdated = null
    this.onUnauthenticated = null
    this.onForbidden = null
    this._refreshPromise = null
  }

  setAuthHooks({ getAccessToken, getDeviceId, onAccessTokenUpdated, onUnauthenticated, onForbidden }) {
    this.getAccessToken = getAccessToken
    this.getDeviceId = getDeviceId
    this.onAccessTokenUpdated = onAccessTokenUpdated
    this.onUnauthenticated = onUnauthenticated
    this.onForbidden = onForbidden
  }

  async refreshTokens() {
    if (this._refreshPromise) return this._refreshPromise

    this._refreshPromise = (async () => {
      try {
        const deviceId = this.getDeviceId ? await this.getDeviceId() : null
        const res = await fetch(this.buildUrl('/auth/refresh'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(deviceId ? { 'X-Device-ID': deviceId } : {}),
          },
          credentials: 'include',
        })

        if (!res.ok) {
          throw new Error('Refresh failed')
        }

        const data = await res.json()
        if (data.access_token && this.onAccessTokenUpdated) {
          await this.onAccessTokenUpdated(data.access_token)
        }
        return data
      } finally {
        this._refreshPromise = null
      }
    })()

    return this._refreshPromise
  }

  buildUrl(path, apiVersion) {
    if (path && path.startsWith('http')) return path

    let url = this.baseUrl
    const version = apiVersion || this.apiVersion

    if (version) {
      const v = version.startsWith('/') ? version : `/${version}`
      if (!url.endsWith(v)) {
        url += v
      }
    }

    if (!path) return url
    if (!path.startsWith('/')) path = '/' + path
    return url + path
  }

  async request(path, { method = 'GET', headers, body, signal, retry = undefined, skipGlobalForbidden = false, apiVersion = undefined } = {}) {
    const isGet = method.toUpperCase() === 'GET'
    const attempts = typeof retry === 'number' ? retry + 1 : isGet ? 3 : 1
    const backoffMs = [0, 200, 500]
    let refreshed = false

    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(backoffMs[Math.min(i, backoffMs.length - 1)])
      try {
        // Merge headers and ensure JSON content type when sending a body
        const mergedHeaders = {
          Accept: 'application/json, text/plain; q=0.8, */*; q=0.5',
          ...this.getHeaders(),
          ...headers,
        }
        if (this.getDeviceId) {
          const dId = await this.getDeviceId()
          if (dId && !('X-Device-ID' in mergedHeaders)) {
            mergedHeaders['X-Device-ID'] = dId
          }
        }
        if (this.getAccessToken) {
          const token = await this.getAccessToken()
          if (token && !('Authorization' in mergedHeaders)) {
            mergedHeaders['Authorization'] = `Bearer ${token}`
          }
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
          credentials: 'include',
        }
        let res
        try {
          res = await fetch(this.buildUrl(path, apiVersion), requestInit)
        } catch (fetchErr) {
          const msg = fetchErr?.message || ''
          const incompatibleSignal = /expected signal.*instance of abortsignal/i.test(msg)
          if (requestInit.signal && incompatibleSignal) {
            // Fallback for cross-realm signal mismatch (jsdom AbortSignal with undici fetch).
            res = await fetch(this.buildUrl(path, apiVersion), { ...requestInit, signal: undefined })
          } else {
            throw fetchErr
          }
        }

        const data = await parseBody(res)
        if (!res.ok) {
          if (res.status === 403 && !skipGlobalForbidden) {
            this.onForbidden?.(data)
          }
          if (res.status === 401 && !path.includes('/auth/refresh') && !refreshed) {
            refreshed = true
            try {
              await this.refreshTokens()
              i--
              continue
            } catch (refreshErr) {
              this.onUnauthenticated?.()
              // Fall through to normal error handling
            }
          }
          const detail =
            typeof data === 'object' && data && (data.detail || data.message)
              ? data.detail || data.message
              : typeof data === 'string'
                ? data
                : ''
          throw new ApiError(detail || `Request failed (HTTP ${res.status})`, {
            status: res.status,
            detail,
            body: typeof data === 'object' && data ? data : { detail: data },
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
  patch(path, body, opts = {}) {
    return this.request(path, { ...opts, method: 'PATCH', body })
  }
  delete(path, opts = {}) {
    return this.request(path, { ...opts, method: 'DELETE' })
  }
}

export const apiClient = new ApiClient()
