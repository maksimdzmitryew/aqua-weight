import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { parseAPIDate, formatDateTime, nowLocalISOMinutes, toLocalISOMinutes } from '../../../src/utils/datetime.js'

describe('utils/datetime', () => {
  afterEach(() => {
    vi.useRealTimers()
    // clean dtFormat preference
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('dtFormat')
    }
  })

  test('parseAPIDate handles nullish, Date, number, SQL-local, ISO, and invalid', () => {
    expect(parseAPIDate(null)).toBeNull()
    expect(parseAPIDate(undefined)).toBeNull()

    const d = new Date(1700000000000)
    expect(parseAPIDate(d)).toEqual(d)

    expect(parseAPIDate(1700000000000)).toEqual(new Date(1700000000000))

    // SQL local string (no timezone) — should parse as local time
    const sql = parseAPIDate('2024-01-02 03:04:05.6')
    expect(sql).toBeInstanceOf(Date)
    expect(sql.getFullYear()).toBe(2024)
    expect(sql.getMonth()).toBe(0)
    expect(sql.getDate()).toBe(2)
    expect(sql.getHours()).toBe(3)
    expect(sql.getMinutes()).toBe(4)

    // ISO with Z should parse via native
    const iso = parseAPIDate('2024-01-02T03:04:05Z')
    expect(iso).toBeInstanceOf(Date)

    // Invalid types/strings
    expect(parseAPIDate({})).toBeNull()
    expect(parseAPIDate('')).toBeNull()
    expect(parseAPIDate('not-a-date')).toBeNull()
  })

  test('parseAPIDate returns null for invalid Date instance and NaN number', () => {
    // Invalid Date instance
    const invalidDate = new Date('not-a-real-date')
    expect(isNaN(invalidDate.getTime())).toBe(true)
    expect(parseAPIDate(invalidDate)).toBeNull()

    // NaN number
    // @ts-ignore
    expect(parseAPIDate(NaN)).toBeNull()
  })

  test('parseAPIDate SQL branch returns null when constructed Date is invalid (guard branch)', () => {
    // Temporarily replace global Date so that the 7-arg constructor path returns an invalid date-like object
    const RealDate = Date
    // eslint-disable-next-line no-inner-declarations
    function FakeDate(...args) {
      // If called with components (y, m, d, h, mi, s, ms) — i.e., SQL branch — make it invalid
      if (args.length === 7) {
        return { getTime: () => NaN }
      }
      // Fallback to native Date for other signatures
      // @ts-ignore
      return new RealDate(...args)
    }
    // Preserve static members used elsewhere
    // @ts-ignore
    FakeDate.UTC = RealDate.UTC
    // @ts-ignore
    FakeDate.parse = RealDate.parse
    // @ts-ignore
    FakeDate.now = RealDate.now
    // @ts-ignore
    FakeDate.prototype = RealDate.prototype

    // @ts-ignore
    globalThis.Date = FakeDate
    try {
      // Matches SQL regex and would normally produce a valid date
      expect(parseAPIDate('2024-01-02 03:04:05.6')).toBeNull()
    } finally {
      // Restore
      // @ts-ignore
      globalThis.Date = RealDate
    }
  })

  test('formatDateTime uses preference and is resilient to bad input', () => {
    // Spy on Date.prototype.toLocaleString to make deterministic
    const original = Date.prototype.toLocaleString
    const calls = []
    // @ts-ignore
    Date.prototype.toLocaleString = function (locale, opts) {
      calls.push({ locale, opts })
      return `${locale}-${opts.hour12 ? '12h' : '24h'}`
    }
    try {
      // Europe preference
      window.localStorage.setItem('dtFormat', 'europe')
      const s1 = formatDateTime('2024-01-02 03:04')
      expect(s1).toBe('en-GB-24h')
      expect(calls.at(-1)).toMatchObject({ locale: 'en-GB', opts: expect.objectContaining({ hour12: false }) })

      // US preference
      window.localStorage.setItem('dtFormat', 'us')
      const s2 = formatDateTime('2024-01-02 03:04')
      expect(s2).toBe('en-US-12h')
      expect(calls.at(-1)).toMatchObject({ locale: 'en-US', opts: expect.objectContaining({ hour12: true }) })

      // Bad input falls back to stringification
      expect(formatDateTime({ a: 1 })).toBe('[object Object]')
      expect(formatDateTime(null)).toBe('')
    } finally {
      Date.prototype.toLocaleString = original
    }
  })

  test('nowLocalISOMinutes returns local ISO to minutes using current time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-05-06T07:08:09.500Z'))
    // The function uses local time; for determinism, assume environment treats this instant and formats local parts.
    const s = nowLocalISOMinutes()
    // Should match pattern YYYY-MM-DDTHH:MM
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  test('toLocalISOMinutes returns empty string for invalid input and formats SQL-local correctly', () => {
    expect(toLocalISOMinutes(null)).toBe('')
    expect(toLocalISOMinutes('')).toBe('')
    expect(toLocalISOMinutes({})).toBe('')

    // SQL local stays same components
    expect(toLocalISOMinutes('2024-01-02 03:04:59')).toBe('2024-01-02T03:04')
    // ISO Z will convert to local; we only assert pattern to avoid TZ dependency
    const iso = toLocalISOMinutes('2024-01-02T03:04:59Z')
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  test('formatDateTime falls back to String(v) when an unexpected error occurs', () => {
    const original = Date.prototype.toLocaleString
    // Force toLocaleString to throw to exercise the catch block (lines 50–51)
    // @ts-ignore
    Date.prototype.toLocaleString = function () { throw new Error('boom') }
    try {
      // Provide a value that parseAPIDate will parse into a Date so that the throw happens inside try {}
      const out = formatDateTime('2024-01-02 03:04')
      expect(out).toBe('2024-01-02 03:04')
    } finally {
      Date.prototype.toLocaleString = original
    }
  })

  test('formatDateTime catch path also triggers when reading preferences throws', () => {
    // Use vitest to stub global localStorage with a throwing getItem
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('ls-err') },
    })
    try {
      const out = formatDateTime('2024-01-02 03:04')
      // When an error occurs inside try{}, function returns String(v)
      expect(out).toBe('2024-01-02 03:04')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
