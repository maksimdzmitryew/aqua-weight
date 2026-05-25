import { describe, expect, test } from 'vitest'
import { checkNeedsWater, getWaterRetainedPct } from '../../../src/utils/watering'

describe('utils/watering', () => {
  describe('checkNeedsWater', () => {
    test('vacation mode: needs water when days_offset <= 0', () => {
      const plant = { recommended_water_threshold_pct: 40 }
      const approximation = { days_offset: 0 }
      expect(checkNeedsWater(plant, 'vacation', approximation)).toBe(true)

      const approximationNegative = { days_offset: -1 }
      expect(checkNeedsWater(plant, 'vacation', approximationNegative)).toBe(true)
    })

    test('vacation mode: does not need water when days_offset > 0 and virtual_water_retained_pct > threshold', () => {
      const plant = { recommended_water_threshold_pct: 40 }
      const approximation = { days_offset: 1, virtual_water_retained_pct: 50 }
      expect(checkNeedsWater(plant, 'vacation', approximation)).toBe(false)
    })

    test('vacation mode: needs water when virtual_water_retained_pct <= threshold', () => {
      const plant = { recommended_water_threshold_pct: 40 }
      const approximation = { days_offset: 1, virtual_water_retained_pct: 40 }
      expect(checkNeedsWater(plant, 'vacation', approximation)).toBe(true)

      const approximationLower = { days_offset: 1, virtual_water_retained_pct: 30 }
      expect(checkNeedsWater(plant, 'vacation', approximationLower)).toBe(true)
    })

    test('vacation mode: uses defaultThreshold if plant.recommended_water_threshold_pct is missing', () => {
      const plant = {}
      const approximation = { days_offset: 1, virtual_water_retained_pct: 35 }
      // defaultThreshold is 40
      expect(checkNeedsWater(plant, 'vacation', approximation)).toBe(true)

      const approximationHigher = { days_offset: 1, virtual_water_retained_pct: 45 }
      expect(checkNeedsWater(plant, 'vacation', approximationHigher)).toBe(false)
    })

    test('manual/automatic mode: returns false if just watered (water_loss_total_pct === 0) and not dry', () => {
      const plant = { water_loss_total_pct: 0, water_retained_pct: 50 }
      expect(checkNeedsWater(plant, 'manual')).toBe(false)
    })

    test('manual/automatic mode: returns true if just watered but water_retained_pct is 0 (dry)', () => {
      const plant = { water_loss_total_pct: 0, water_retained_pct: 0 }
      expect(checkNeedsWater(plant, 'manual')).toBe(true)
    })

    test('manual/automatic mode: uses defaultThreshold when recommended_water_threshold_pct is null/undefined (LINES 38-39)', () => {
      const plant = { water_retained_pct: 35 }
      // defaultThreshold is 40, so 35 <= 40 => true
      expect(checkNeedsWater(plant, 'manual')).toBe(true)

      const plantHigher = { water_retained_pct: 45 }
      // defaultThreshold is 40, so 45 <= 40 => false
      expect(checkNeedsWater(plantHigher, 'manual')).toBe(false)
    })

    test('manual/automatic mode: uses custom defaultThreshold', () => {
      const plant = { water_retained_pct: 25 }
      // custom defaultThreshold 20, so 25 <= 20 => false
      expect(checkNeedsWater(plant, 'manual', null, 20)).toBe(false)
    })

    test('manual/automatic mode: handles NaN values gracefully', () => {
      const plant = { water_retained_pct: 'not-a-number' }
      expect(checkNeedsWater(plant, 'manual')).toBe(false)
    })

    test('no weight data but has approximation: uses days_offset', () => {
      const plant = { water_retained_pct: null }
      const approximation = { days_offset: 0 }
      expect(checkNeedsWater(plant, 'manual', approximation)).toBe(true)

      const approximationFuture = { days_offset: 1 }
      expect(checkNeedsWater(plant, 'manual', approximationFuture)).toBe(false)
    })

    test('no weight data and no approximation: returns true', () => {
      const plant = { water_retained_pct: null }
      expect(checkNeedsWater(plant, 'manual')).toBe(true)
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
