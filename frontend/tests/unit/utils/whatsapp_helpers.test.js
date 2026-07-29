import { describe, expect, test, vi, afterEach } from 'vitest'
import {
  getHelpers,
  addHelper,
  updateHelper,
  removeHelper,
  getOwnerUserId,
} from '../../../src/utils/whatsapp_helpers.js'

describe('utils/whatsapp_helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getHelpers', () => {
    test('returns empty array when localStorage is empty', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => null,
      })
      expect(getHelpers()).toEqual([])
    })

    test('returns parsed JSON array from localStorage', () => {
      const helpers = [{ id: '1', name: 'Test Helper' }]
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify(helpers),
      })
      expect(getHelpers()).toEqual(helpers)
    })

    test('returns empty array when JSON.parse throws (catch block, lines 9-11)', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => 'invalid json',
      })
      expect(getHelpers()).toEqual([])
    })

    test('returns empty array when getItem throws (catch block)', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('storage error')
        },
      })
      expect(getHelpers()).toEqual([])
    })
  })

  describe('addHelper', () => {
    test('adds helper with generated id and returns it', () => {
      const stored = []
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify(stored),
        setItem: (key, value) => {
          stored.length = 0
          stored.push(...JSON.parse(value))
        },
      })

      // Mock crypto.randomUUID to return deterministic value
      vi.stubGlobal('crypto', {
        randomUUID: () => 'test-uuid-1234',
      })

      const helper = { name: 'New Helper', type: 'watering' }
      const result = addHelper(helper)

      expect(result).toMatchObject({
        name: 'New Helper',
        type: 'watering',
        id: 'test-uuid-1234',
      })

      expect(getHelpers()).toHaveLength(1)
      expect(getHelpers()[0].id).toBe('test-uuid-1234')
    })

    test('generates id using fallback when crypto.randomUUID is undefined (line 16)', () => {
      const stored = []
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify(stored),
        setItem: (key, value) => {
          stored.length = 0
          stored.push(...JSON.parse(value))
        },
      })

      // Mock crypto.randomUUID to be undefined to test fallback
      vi.stubGlobal('crypto', {
        randomUUID: undefined,
      })

      const helper = { name: 'Fallback Helper' }
      const result = addHelper(helper)

      expect(result).toMatchObject({
        name: 'Fallback Helper',
        id: expect.any(String),
      })
      expect(result.id.length).toBeGreaterThan(0)
    })
  })

  describe('updateHelper', () => {
    test('updates existing helper and returns it', () => {
      const initial = [{ id: '1', name: 'Helper 1', type: 'watering' }]
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify(initial),
        setItem: (key, value) => {
          initial.length = 0
          initial.push(...JSON.parse(value))
        },
      })

      const result = updateHelper('1', { name: 'Updated Name' })

      expect(result).toEqual({ id: '1', name: 'Updated Name', type: 'watering' })
      expect(getHelpers()).toEqual([{ id: '1', name: 'Updated Name', type: 'watering' }])
    })

    test('returns undefined when helper not found (lines 25-30)', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify([]),
        setItem: vi.fn(),
      })

      const result = updateHelper('nonexistent', { name: 'Test' })

      expect(result).toBeUndefined()
    })

    test('does not modify localStorage when helper not found', () => {
      const initial = [{ id: '1', name: 'Helper 1' }]
      let storedValue = JSON.stringify(initial)
      vi.stubGlobal('localStorage', {
        getItem: () => storedValue,
        setItem: (key, value) => {
          storedValue = value
        },
      })

      updateHelper('nonexistent', { name: 'Test' })

      expect(storedValue).toBe(JSON.stringify(initial))
    })
  })

  describe('removeHelper', () => {
    test('removes helper by id and returns filtered array', () => {
      const initial = [
        { id: '1', name: 'Helper 1' },
        { id: '2', name: 'Helper 2' },
      ]
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify(initial),
        setItem: (key, value) => {
          initial.length = 0
          initial.push(...JSON.parse(value))
        },
      })

      const result = removeHelper('1')

      expect(result).toEqual([{ id: '2', name: 'Helper 2' }])
      expect(getHelpers()).toEqual([{ id: '2', name: 'Helper 2' }])
    })

    test('returns all helpers when id not found', () => {
      const initial = [{ id: '1', name: 'Helper 1' }]
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify(initial),
        setItem: (key, value) => {
          initial.length = 0
          initial.push(...JSON.parse(value))
        },
      })

      const result = removeHelper('nonexistent')

      expect(result).toEqual([{ id: '1', name: 'Helper 1' }])
    })
  })

  describe('getOwnerUserId', () => {
    test('returns userId from localStorage', () => {
      vi.stubGlobal('localStorage', {
        getItem: (key) => (key === 'userId' ? 'user-123' : null),
      })
      expect(getOwnerUserId()).toBe('user-123')
    })

    test('returns null when userId is not set (lines 40-41)', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => null,
      })
      expect(getOwnerUserId()).toBe(null)
    })

    test('returns null when getItem throws (catch block, lines 42-44)', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('storage error')
        },
      })
      expect(getOwnerUserId()).toBe(null)
    })
  })
})