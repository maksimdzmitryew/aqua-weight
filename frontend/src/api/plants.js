import { apiClient, ApiError } from './client'

export const plantsApi = {
  list(signal) {
    return apiClient.get('/plants', { signal })
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
    return apiClient.put('/plants/order', { ordered_ids: orderedIds }, {
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
  },
  remove(uuid, signal) {
    if (!uuid) throw new ApiError('Missing plant id')
    return apiClient.delete(`/plants/${uuid}`, { signal })
  },
  getApproximation(signal) {
    return apiClient.get('/measurements/approximation/watering', { signal })
  },
}
