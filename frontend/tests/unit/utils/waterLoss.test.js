import { describe, expect, test } from 'vitest'
import { waterLossCellStyle } from '../../../src/utils/waterLoss.js'

describe('utils/waterLoss', () => {
  test('returns correct styles across threshold boundaries', () => {
    // > 100
    expect(waterLossCellStyle(101)).toEqual({ background: '#dc2626', color: 'white' })
    // exactly 100 falls to next branch (>80)
    expect(waterLossCellStyle(100)).toEqual({ background: '#fecaca' })

    // > 80
    expect(waterLossCellStyle(81)).toEqual({ background: '#fecaca' })
    // exactly 80 falls to next branch (>40)
    expect(waterLossCellStyle(80)).toEqual({ background: '#fef3c7' })

    // > 40
    expect(waterLossCellStyle(41)).toEqual({ background: '#fef3c7' })
    // exactly 40 falls to next branch (>3)
    expect(waterLossCellStyle(40)).toEqual({ background: '#bbf7d0' })

    // > 3
    expect(waterLossCellStyle(4)).toEqual({ background: '#bbf7d0' })
    // exactly 3 falls to next branch (> -1)
    expect(waterLossCellStyle(3)).toEqual({ color: 'green' })

    // > -1
    expect(waterLossCellStyle(0)).toEqual({ color: 'green' })
    expect(waterLossCellStyle(-0.5)).toEqual({ color: 'green' })
    // exactly -1 falls to else (red)
    expect(waterLossCellStyle(-1)).toEqual({ color: 'red' })
    // less than -1 stays red
    expect(waterLossCellStyle(-2)).toEqual({ color: 'red' })
  })
})
