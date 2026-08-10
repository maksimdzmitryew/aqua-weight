import { describe, it, expect, vi, beforeEach } from 'vitest'
import { measurementsApi } from '../../../src/api/measurements'
import { apiClient, ApiError } from '../../../src/api/client'

vi.mock('../../../src/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class extends Error {
    constructor(message) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

describe('measurementsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listByPlant throws if no plantUuid', () => {
    expect(() => measurementsApi.listByPlant()).toThrow('Missing plant id')
  })

  it('getById throws if no plantId or id', () => {
    expect(() => measurementsApi.getById()).toThrow('Missing plant id')
    expect(() => measurementsApi.getById('p1')).toThrow('Missing measurement id')
  })

  it('delete throws if no plantId or id', () => {
    expect(() => measurementsApi.delete()).toThrow('Missing plant id')
    expect(() => measurementsApi.delete('p1')).toThrow('Missing measurement id')
  })

  describe('weight', () => {
    it('create handles mode and payload cleanup', async () => {
      await measurementsApi.weight.create('p1', { plant_id: 'p1', val: 10 }, null, 'test')
      expect(apiClient.post).toHaveBeenCalledWith(
        '/plants/p1/measurements/weight?mode=test',
        { val: 10 },
        expect.any(Object),
      )
    })

    it('update throws if missing ids', () => {
      expect(() => measurementsApi.weight.update()).toThrow('Missing plant id')
      expect(() => measurementsApi.weight.update('p1')).toThrow('Missing measurement id')
    })
  })

  describe('watering', () => {
    it('createVacation works', async () => {
      await measurementsApi.watering.createVacation('p1', { plant_id: 'p1', water: 50 })
      expect(apiClient.post).toHaveBeenCalledWith(
        '/plants/p1/measurements/vacation/watering',
        { water: 50 },
        expect.any(Object),
      )
    })

    it('update throws if missing ids', () => {
      expect(() => measurementsApi.watering.update()).toThrow('Missing plant id')
      expect(() => measurementsApi.watering.update('p1')).toThrow('Missing measurement id')
    })

    it('update works with mode', async () => {
      await measurementsApi.watering.update('p1', 'm1', { val: 5 }, null, 'bulk')
      expect(apiClient.put).toHaveBeenCalledWith(
        '/plants/p1/measurements/watering/m1?mode=bulk',
        { val: 5 },
        expect.any(Object),
      )
    })
  })

  describe('repotting', () => {
    it('get throws if missing ids', () => {
      expect(() => measurementsApi.repotting.get()).toThrow('Missing plant id')
      expect(() => measurementsApi.repotting.get('p1')).toThrow('Missing repotting id')
    })

    it('create throws if missing plantId', () => {
      expect(() => measurementsApi.repotting.create()).toThrow('Missing plant id')
    })

    it('update throws if missing ids', () => {
      expect(() => measurementsApi.repotting.update()).toThrow('Missing plant id')
      expect(() => measurementsApi.repotting.update('p1')).toThrow('Missing repotting id')
    })

    it('update works', async () => {
      await measurementsApi.repotting.update('p1', 'r1', { plant_id: 'p1', note: 'ok' })
      expect(apiClient.put).toHaveBeenCalledWith(
        '/plants/p1/repotting/r1',
        { note: 'ok' },
        expect.any(Object),
      )
    })
  })
})
