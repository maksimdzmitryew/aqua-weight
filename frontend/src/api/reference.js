import { apiClient } from './client'

export const referenceApi = {
  listSubstrateTypes: async () => {
    return apiClient.get('/substrate-types')
  },

  listLightLevels: async () => {
    return apiClient.get('/light-levels')
  },

  listPestStatuses: async () => {
    return apiClient.get('/pest-statuses')
  },

  listHealthStatuses: async () => {
    return apiClient.get('/health-statuses')
  },

  listScales: async () => {
    return apiClient.get('/scales')
  },

  listMethods: async () => {
    return apiClient.get('/measurement-methods')
  },
}
