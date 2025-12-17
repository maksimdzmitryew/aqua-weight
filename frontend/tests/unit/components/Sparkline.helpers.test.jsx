import { describe, it, expect } from 'vitest'

import {
  computeFirstBelow,
  shouldHideFirstBelow,
  computeDaysSincePrevPeak,
  computePeakVLines,
  findNearestIndexByX,
  buildDefaultHoverLines,
} from '../../../src/components/Sparkline.jsx'

describe('Sparkline helpers', () => {
  it('computeFirstBelow returns null for invalid input', () => {
    expect(computeFirstBelow(null, 10)).toBeNull()
    expect(computeFirstBelow([], 10)).toBeNull()
    expect(computeFirstBelow([{ x: 1, y: 1 }], 10)).toBeNull()
    expect(computeFirstBelow([{ x: 1, y: 2 }, { x: 2, y: 3 }], null)).toBeNull()
    expect(computeFirstBelow([{ x: 1, y: 2 }, { x: 2, y: 3 }], 10, false)).toBeNull()
  })

  it('computeFirstBelow detects first crossing below threshold', () => {
    const pts = [
      { x: 1000, y: 50 },
      { x: 2000, y: 60 },
      { x: 3000, y: 39 }, // first below 40
      { x: 4000, y: 41 },
    ]
    const res = computeFirstBelow(pts, 40)
    expect(res).toEqual({ x: 3000, y: 39, index: 2 })
  })

  it('shouldHideFirstBelow hides when a peak vline exists on same day', () => {
    const dayKey = (x) => new Date(x).toISOString().slice(0, 10)
    const first = { x: Date.UTC(2025, 0, 2), y: 10, index: 3 }
    const peakVLines = [
      { x: Date.UTC(2025, 0, 1) },
      { x: Date.UTC(2025, 0, 2) }, // same day
      { x: Date.UTC(2025, 0, 3) },
    ]
    expect(shouldHideFirstBelow(first, peakVLines, dayKey)).toBe(true)
    const otherDay = [{ x: Date.UTC(2025, 0, 1) }]
    expect(shouldHideFirstBelow(first, otherDay, dayKey)).toBe(false)
  })

  it('computeDaysSincePrevPeak calculates days since previous peak or start', () => {
    const startOfDay = (ts) => {
      const d = new Date(ts)
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    }
    const points = [
      { x: Date.UTC(2025, 0, 1), y: 10 },
      { x: Date.UTC(2025, 0, 2), y: 12 },
      { x: Date.UTC(2025, 0, 3), y: 9 },
    ]
    const peakVLines = [ { x: Date.UTC(2025, 0, 2) } ]
    const firstBelow = { x: Date.UTC(2025, 0, 3), y: 9, index: 2 }
    const days = computeDaysSincePrevPeak(firstBelow, peakVLines, points, startOfDay)
    expect(days).toBe(1)
  })

  it('computePeakVLines identifies peaks with sufficient delta and labels per locale', () => {
    const pts = [
      { x: Date.UTC(2025, 0, 1), y: 10 },
      { x: Date.UTC(2025, 0, 2), y: 40 }, // peak vs 10, delta 30
      { x: Date.UTC(2025, 0, 3), y: 20 },
    ]
    const resEU = computePeakVLines(pts, /*maxWaterG*/ 100, /*peakDeltaPct*/ 0.2, 'europe')
    expect(resEU).toHaveLength(1)
    expect(resEU[0]).toMatchObject({ x: Date.UTC(2025,0,2), y: 40, label: '02/01' })
    const resUS = computePeakVLines(pts, 100, 0.2, 'usa')
    expect(resUS[0].label).toBe('01/02')
  })

  it('findNearestIndexByX returns nearest index or null', () => {
    expect(findNearestIndexByX([], 0)).toBeNull()
    const pts = [{ x: 0 }, { x: 10 }, { x: 20 }]
    expect(findNearestIndexByX(pts, 12)).toBe(1)
    expect(findNearestIndexByX(pts, 19)).toBe(2)
  })

  it('buildDefaultHoverLines formats date/time and delta for both locales and invalid date', () => {
    const pts = [
      { x: Date.UTC(2025, 0, 1, 13, 5), y: 100 },
      { x: Date.UTC(2025, 0, 1, 14, 10), y: 120 },
    ]
    const linesEU = buildDefaultHoverLines(pts, 1, () => 'europe')
    expect(linesEU[0]).toMatch(/01\/01\/2025 14:10/)
    expect(linesEU[1]).toBe('120 g')
    expect(linesEU[2]).toBe('Δ +20 g')

    const linesUS = buildDefaultHoverLines(pts, 1, () => 'usa')
    expect(linesUS[0]).toMatch(/01\/01\/2025 2:10 PM/)

    // invalid date falls back to raw value
    const bad = [{ x: 'not-a-date', y: 1 }]
    const badLines = buildDefaultHoverLines(bad, 0)
    expect(badLines[0]).toBe('not-a-date')
  })
})
