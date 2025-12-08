import { describe, expect, test } from 'vitest'
import { getWaterRetainCellStyle, getWaterLossCellStyle, valueStyle } from '../../../src/utils/water_retained_colors.js'

describe('utils/water_retained_colors', () => {
  test('valueStyle contains numeric font settings', () => {
    expect(valueStyle).toMatchObject({ position: 'relative', textAlign: 'right', fontVariantNumeric: 'tabular-nums' })
  })

  test('getWaterRetainCellStyle returns gradient background clamped between 0 and 100 percent', () => {
    expect(getWaterRetainCellStyle(-10).background).toContain('0%')
    expect(getWaterRetainCellStyle(0).background).toBe('linear-gradient(90deg, rgba(79, 173, 255, 0.28) 0%, transparent 0%)')
    expect(getWaterRetainCellStyle(50).background).toBe('linear-gradient(90deg, rgba(79, 173, 255, 0.28) 50%, transparent 50%)')
    expect(getWaterRetainCellStyle(100).background).toBe('linear-gradient(90deg, rgba(79, 173, 255, 0.28) 100%, transparent 100%)')
    expect(getWaterRetainCellStyle(150).background).toBe('linear-gradient(90deg, rgba(79, 173, 255, 0.28) 100%, transparent 100%)')
  })

  test('getWaterLossCellStyle mirrors thresholds for loss percentage', () => {
    expect(getWaterLossCellStyle(101)).toEqual({ background: '#dc2626', color: 'white' })
    expect(getWaterLossCellStyle(100)).toEqual({ background: '#fecaca' })
    expect(getWaterLossCellStyle(81)).toEqual({ background: '#fecaca' })
    expect(getWaterLossCellStyle(80)).toEqual({ background: '#fef3c7' })
    expect(getWaterLossCellStyle(41)).toEqual({ background: '#fef3c7' })
    expect(getWaterLossCellStyle(40)).toEqual({ background: '#bbf7d0' })
    expect(getWaterLossCellStyle(4)).toEqual({ background: '#bbf7d0' })
    expect(getWaterLossCellStyle(3)).toEqual({ color: 'green' })
    expect(getWaterLossCellStyle(0)).toEqual({ color: 'green' })
    expect(getWaterLossCellStyle(-1)).toEqual({ color: 'red' })
  })
})
