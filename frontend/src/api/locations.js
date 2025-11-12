import { apiClient, ApiError } from './client'

export const locationsApi = {
  list(signal) {
    return apiClient.get('/locations', { signal })
  },
  create(payload, signal) {
    return apiClient.post('/locations', payload, {
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
  },
  updateByName(original_name, name, signal) {
    if (!name) throw new ApiError('Name is required')
    const payload = { original_name, name }
    return apiClient.put('/locations/by-name', payload, {
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
  },
  remove(uuid, signal) {
    if (!uuid) throw new ApiError('Missing location id')
    return apiClient.delete(`/locations/${uuid}`, { signal })
  },
  reorder(orderedIds, signal) {
    return apiClient.put('/locations/order', { ordered_ids: orderedIds }, {
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
  },
}
