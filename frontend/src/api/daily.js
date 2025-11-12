import { apiClient } from './client'

export const dailyApi = {
  list(signal) {
    return apiClient.get('/daily', { signal })
  },
}
