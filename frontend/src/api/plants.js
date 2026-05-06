import { apiClient, ApiError } from './client'

export const plantsApi = {
  list({ page = 1, limit = 20, search = '', status = 'active', signal } = {}) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), status })
    if (search && search.trim()) {
      params.append('search', search.trim())
    }
    return apiClient.get(`/plants?${params}`, { signal })
  },
  listNames(signal) {
    return apiClient.get('/plants/names', { signal })
  },
  getByUuid(uuid, signal) {
    if (!uuid) throw new ApiError('Missing plant id')
    return apiClient.get(`/plants/${uuid}`, { signal })
  },
  create(payload, signal) {
    return apiClient.post('/plants', payload, {
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
  },
  update(uuid, payload, signal) {
    if (!uuid) throw new ApiError('Missing plant id')
    return apiClient.put(`/plants/${uuid}`, payload, {
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
  },
  reorder(orderedIds, signal) {
    return apiClient.put(
      '/plants/order',
      { ordered_ids: orderedIds },
      {
        headers: { 'Content-Type': 'application/json' },
        signal,
      },
    )
  },
  remove(uuid, signal) {
    if (!uuid) throw new ApiError('Missing plant id')
    return apiClient.delete(`/plants/${uuid}`, { signal })
  },
  getApproximation(signal) {
    return apiClient.get('/measurements/approximation/watering', { signal })
  },
}
