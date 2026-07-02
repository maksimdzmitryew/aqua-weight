import { describe, expect, test } from 'vitest'
import { checkNeedsWater, getWaterRetainedPct } from '../../../src/utils/watering'

describe('utils/watering', () => {
  describe('checkNeedsWater', () => {
    test('returns true when plant.needs_water is true', () => {
      const plant = { needs_water: true }
      expect(checkNeedsWater(plant)).toBe(true)
    })

    test('returns false when plant.needs_water is false', () => {
      const plant = { needs_water: false }
      expect(checkNeedsWater(plant)).toBe(false)
    })

    test('returns false when plant.needs_water is undefined', () => {
      const plant = {}
      expect(checkNeedsWater(plant)).toBe(false)
    })

    test('returns false when plant is null', () => {
      expect(checkNeedsWater(null)).toBe(false)
    })

    test('returns false when plant is undefined', () => {
      expect(checkNeedsWater(undefined)).toBe(false)
    })
  })

  describe('getWaterRetainedPct', () => {
    test('vacation mode: returns rounded virtual_water_retained_pct', () => {
      const plant = { water_retained_pct: 50 }
      const approximation = { virtual_water_retained_pct: 40.6 }
      expect(getWaterRetainedPct(plant, 'vacation', approximation)).toBe(41)
    })

    test('vacation mode: returns "N/A" if virtual_water_retained_pct is missing', () => {
      const plant = { water_retained_pct: 50 }
      const approximation = {}
      expect(getWaterRetainedPct(plant, 'vacation', approximation)).toBe('N/A')
    })

    test('non-vacation mode: returns rounded water_retained_pct', () => {
      const plant = { water_retained_pct: 75.2 }
      expect(getWaterRetainedPct(plant, 'manual')).toBe(75)
    })

    test('non-vacation mode: returns "N/A" if water_retained_pct is missing', () => {
      const plant = {}
      expect(getWaterRetainedPct(plant, 'manual')).toBe('N/A')
    })
  })
})
