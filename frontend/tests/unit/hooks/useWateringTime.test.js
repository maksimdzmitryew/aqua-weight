import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useWateringTime from '../../../src/hooks/useWateringTime'

describe('useWateringTime hook', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes with real-time mode and current time', () => {
    const { result } = renderHook(() => useWateringTime())
    expect(result.current.mode).toBe('real-time')
    expect(result.current.frozen).toBe(false)
    expect(result.current.dateTime).toBe('2025-01-01T12:00:00')
  })

  it('advances time in real-time mode', () => {
    const { result } = renderHook(() => useWateringTime())

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.dateTime).toBe('2025-01-01T12:00:01')
  })

  it('stops advancing when frozen', () => {
    const { result } = renderHook(() => useWateringTime())

    act(() => {
      result.current.setFrozen(true)
    })

    expect(result.current.frozen).toBe(true)
    expect(result.current.mode).toBe('manual')

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.dateTime).toBe('2025-01-01T12:00:00')
  })

  it('resumes advancing from frozen value when unfrozen', () => {
    const { result } = renderHook(() => useWateringTime())

    act(() => {
      vi.advanceTimersByTime(2000)
      result.current.setFrozen(true)
    })

    expect(result.current.dateTime).toBe('2025-01-01T12:00:02')

    act(() => {
      vi.advanceTimersByTime(5000)
      result.current.setFrozen(false)
    })

    // Should still be at :02 right after unfreeze
    expect(result.current.dateTime).toBe('2025-01-01T12:00:02')

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.dateTime).toBe('2025-01-01T12:00:03')
  })

  it('switches to manual mode without freezing', () => {
    const { result } = renderHook(() => useWateringTime())

    act(() => {
      result.current.setMode('manual')
    })

    expect(result.current.mode).toBe('manual')
    expect(result.current.frozen).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.dateTime).toBe('2025-01-01T12:00:01')
  })

  it('resets to real-time from manual/frozen', () => {
    const { result } = renderHook(() => useWateringTime())

    act(() => {
      result.current.setFrozen(true)
    })

    act(() => {
      vi.advanceTimersByTime(10000) // system time moves, but hook is frozen
    })

    expect(result.current.dateTime).toBe('2025-01-01T12:00:00')

    act(() => {
      result.current.setMode('real-time')
    })

    expect(result.current.mode).toBe('real-time')
    expect(result.current.frozen).toBe(false)
    expect(result.current.dateTime).toBe('2025-01-01T12:00:10')
  })

  it('updates anchor when setting datetime manually', () => {
    const { result } = renderHook(() => useWateringTime())

    act(() => {
      result.current.setDateTime('2025-05-05T10:00:00')
    })

    expect(result.current.mode).toBe('manual')
    expect(result.current.dateTime).toBe('2025-05-05T10:00:00')

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.dateTime).toBe('2025-05-05T10:00:01')
  })

  it('ignores invalid datetime string and keeps previous displayTime', () => {
    const { result } = renderHook(() => useWateringTime())

    const before = result.current.dateTime

    act(() => {
      result.current.setDateTime('not-a-valid-date')
    })

    expect(result.current.mode).toBe('manual')
    expect(result.current.dateTime).toBe(before)
  })

  it('updateDisplay skips update when frozen (branch coverage)', () => {
    const { result } = renderHook(() => useWateringTime())

    // Freeze immediately so the effect never sets up an interval while frozen,
    // and updateDisplay (with frozen=true in its closure) is built but guarded.
    // Advance timers inside the same act so any pending tick fires while React
    // is still flushing — exercising the `if (frozen) return` true branch.
    act(() => {
      result.current.setFrozen(true)
      vi.advanceTimersByTime(200)
    })

    const frozenTime = result.current.dateTime

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.dateTime).toBe(frozenTime)
    expect(result.current.frozen).toBe(true)
  })

  it('getCommitDateTime returns millisecond precision', () => {
    const { result } = renderHook(() => useWateringTime())

    act(() => {
      vi.advanceTimersByTime(123)
    })

    expect(result.current.getCommitDateTime()).toBe('2025-01-01T12:00:00.123')

    act(() => {
      result.current.setFrozen(true)
      vi.advanceTimersByTime(1000)
    })

    // Should still be at .123 because it's frozen
    expect(result.current.getCommitDateTime()).toBe('2025-01-01T12:00:00.123')
  })
})
