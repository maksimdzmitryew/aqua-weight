import { apiClient, ApiError } from './client'

export const measurementsApi = {
  listByPlant(plantUuid, signal) {
    if (!plantUuid) throw new ApiError('Missing plant id')
    return apiClient.get(`/plants/${plantUuid}/measurements`, { signal })
  },
  getById(plantId, id, signal) {
    if (!plantId) throw new ApiError('Missing plant id')
    if (!id) throw new ApiError('Missing measurement id')
    return apiClient.get(`/plants/${plantId}/measurements/${id}`, { signal })
  },
  delete(plantId, id, signal) {
    if (!plantId) throw new ApiError('Missing plant id')
    if (!id) throw new ApiError('Missing measurement id')
    return apiClient.delete(`/plants/${plantId}/measurements/${id}`, { signal })
  },
  weight: {
    create(plantId, payload, signal, mode) {
      if (!plantId) throw new ApiError('Missing plant id')
      const rest = { ...(payload || {}) }
      delete rest.plant_id
      const url = mode
        ? `/plants/${plantId}/measurements/weight?mode=${mode}`
        : `/plants/${plantId}/measurements/weight`
      return apiClient.post(url, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
    update(plantId, id, payload, signal, mode) {
      if (!plantId) throw new ApiError('Missing plant id')
      if (!id) throw new ApiError('Missing measurement id')
      const rest = { ...(payload || {}) }
      delete rest.plant_id
      const url = mode
        ? `/plants/${plantId}/measurements/weight/${id}?mode=${mode}`
        : `/plants/${plantId}/measurements/weight/${id}`
      return apiClient.put(url, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
  },
  watering: {
    create(plantId, payload, signal, mode) {
      if (!plantId) throw new ApiError('Missing plant id')
      const rest = { ...(payload || {}) }
      delete rest.plant_id
      const url = mode
        ? `/plants/${plantId}/measurements/watering?mode=${mode}`
        : `/plants/${plantId}/measurements/watering`
      return apiClient.post(url, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
    createVacation(plantId, payload, signal) {
      if (!plantId) throw new ApiError('Missing plant id')
      const rest = { ...(payload || {}) }
      delete rest.plant_id
      return apiClient.post(`/plants/${plantId}/measurements/vacation/watering`, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
    update(plantId, id, payload, signal, mode) {
      if (!plantId) throw new ApiError('Missing plant id')
      if (!id) throw new ApiError('Missing measurement id')
      const rest = { ...(payload || {}) }
      delete rest.plant_id
      const url = mode
        ? `/plants/${plantId}/measurements/watering/${id}?mode=${mode}`
        : `/plants/${plantId}/measurements/watering/${id}`
      return apiClient.put(url, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
  },
  repotting: {
    get(plantId, id, signal) {
      if (!plantId) throw new ApiError('Missing plant id')
      if (!id) throw new ApiError('Missing repotting id')
      // Reuse the generic measurement fetch endpoint
      return apiClient.get(`/plants/${plantId}/measurements/${id}`, { signal })
    },
    create(plantId, payload, signal) {
      if (!plantId) throw new ApiError('Missing plant id')
      const rest = { ...(payload || {}) }
      delete rest.plant_id
      return apiClient.post(`/plants/${plantId}/repotting`, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
    update(plantId, id, payload, signal) {
      if (!plantId) throw new ApiError('Missing plant id')
      if (!id) throw new ApiError('Missing repotting id')
      const rest = { ...(payload || {}) }
      delete rest.plant_id
      return apiClient.put(`/plants/${plantId}/repotting/${id}`, rest, {
        headers: { 'Content-Type': 'application/json' },
        signal,
      })
    },
  },
}
