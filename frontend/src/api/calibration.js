import { apiClient } from './client'

export const calibrationApi = {
  list(signal) {
    return apiClient.get('/measurements/calibrating', { signal })
  },
  correct(payload, { signal } = {}) {
    const { plant_id, ...rest } = payload
    if (!plant_id) throw new Error('Missing plant id')
    return apiClient.post(`/plants/${plant_id}/measurements/corrections`, rest, { signal })
  },
}
