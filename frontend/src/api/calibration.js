import { apiClient } from './client'

export const calibrationApi = {
  list(signal) {
    return apiClient.get('/measurements/calibrating', { signal })
  },
  correct(payload, { signal } = {}) {
    return apiClient.post('/measurements/corrections', payload, { signal })
  },
}
