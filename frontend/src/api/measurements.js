import { apiClient, ApiError } from './client'

export const measurementsApi = {
  listByPlant(plantUuid, signal) {
    if (!plantUuid) throw new ApiError('Missing plant id')
    return apiClient.get(`/plants/${plantUuid}/measurements`, { signal })
  },
  getById(id, signal) {
    if (!id) throw new ApiError('Missing measurement id')
    return apiClient.get(`/measurements/${id}`, { signal })
  },
  delete(id, signal) {
    if (!id) throw new ApiError('Missing measurement id')
    return apiClient.delete(`/measurements/${id}`, { signal })
  },
  weight: {
    create(payload, signal, mode) {
      const { plant_id, ...rest } = payload
      if (!plant_id) throw new ApiError('Missing plant id')
      const url = mode
        ? `/plants/${plant_id}/measurements/weight?mode=${mode}`
        : `/plants/${plant_id}/measurements/weight`
      return apiClient.post(url, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
    update(id, payload, signal, mode) {
      if (!id) throw new ApiError('Missing measurement id')
      const url = mode ? `/measurements/weight/${id}?mode=${mode}` : `/measurements/weight/${id}`
      return apiClient.put(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
  },
  watering: {
    create(payload, signal, mode) {
      const { plant_id, ...rest } = payload
      if (!plant_id) throw new ApiError('Missing plant id')
      const url = mode
        ? `/plants/${plant_id}/measurements/watering?mode=${mode}`
        : `/plants/${plant_id}/measurements/watering`
      return apiClient.post(url, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
    createVacation(payload, signal) {
      const { plant_id, ...rest } = payload
      if (!plant_id) throw new ApiError('Missing plant id')
      return apiClient.post(`/plants/${plant_id}/measurements/vacation/watering`, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
    update(id, payload, signal, mode) {
      if (!id) throw new ApiError('Missing measurement id')
      const url = mode
        ? `/measurements/watering/${id}?mode=${mode}`
        : `/measurements/watering/${id}`
      return apiClient.put(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
  },
  repotting: {
    get(id, signal) {
      if (!id) throw new ApiError('Missing repotting id')
      // Reuse the generic measurement fetch endpoint; backend does not expose /events/repotting/{id}
      return apiClient.get(`/measurements/${id}`, { signal })
    },
    create(payload, signal) {
      return apiClient.post('/measurements/repotting', payload, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
    update(id, payload, signal) {
      if (!id) throw new ApiError('Missing repotting id')
      return apiClient.put(`/measurements/repotting/${id}`, payload, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
  },
}
