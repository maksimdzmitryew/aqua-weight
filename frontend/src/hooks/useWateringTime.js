import { useState, useEffect, useCallback, useRef } from 'react'
import { nowLocalISOSeconds } from '../utils/datetime'

/**
 * useWateringTime - Encapsulates the state machine for the watering time control bar.
 * Provides drift-free timing using a reference timestamp and Date.now() diff.
 */
export default function useWateringTime() {
  const [mode, setMode] = useState('real-time') // 'real-time' | 'manual'
  const [frozen, setFrozen] = useState(false)
  const [displayTime, setDisplayTime] = useState(nowLocalISOSeconds())

  // Timing anchors for drift-free advancement
  // wallTime: the starting point (ms since epoch)
  // refTime: the Date.now() when wallTime was anchored
  const anchorRef = useRef({ wallTime: Date.now(), refTime: Date.now() })

  const formatDateTime = (date) => {
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  const updateDisplay = useCallback(() => {
    const elapsed = Date.now() - anchorRef.current.refTime
    const currentWall = new Date(anchorRef.current.wallTime + elapsed)
    setDisplayTime(formatDateTime(currentWall))
  }, [])

  useEffect(() => {
    if (frozen) return
    // Update every 100ms for smooth UI, though 1s would suffice for displayTime
    const timer = setInterval(updateDisplay, 100)
    return () => clearInterval(timer)
  }, [frozen, updateDisplay])

  // Actions
  const handleModeChange = (newMode) => {
    if (newMode === 'real-time') {
      setMode('real-time')
      setFrozen(false)
      // Reset anchor to current real time
      anchorRef.current = { wallTime: Date.now(), refTime: Date.now() }
      setDisplayTime(formatDateTime(new Date(anchorRef.current.wallTime)))
    } else {
      setMode('manual')
      // Frozen state is preserved when switching to manual (if it was somehow set)
    }
  }

  const handleFrozenChange = (isFrozen) => {
    if (isFrozen) {
      // Freezing: calculate exact current wall time and set as static anchor
      const elapsed = Date.now() - anchorRef.current.refTime
      anchorRef.current = { wallTime: anchorRef.current.wallTime + elapsed, refTime: Date.now() }
      setDisplayTime(formatDateTime(new Date(anchorRef.current.wallTime)))
      setFrozen(true)
      setMode('manual')
    } else {
      // Unfreezing: start advancing from where we are
      anchorRef.current = { wallTime: anchorRef.current.wallTime, refTime: Date.now() }
      setFrozen(false)
    }
  }

  const handleDateTimeChange = (isoString) => {
    setMode('manual')
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return

    // Update anchor to user-specified time
    anchorRef.current = { wallTime: d.getTime(), refTime: Date.now() }
    setDisplayTime(isoString)
  }

  const getCommitDateTime = () => {
    const elapsed = frozen ? 0 : Date.now() - anchorRef.current.refTime
    const d = new Date(anchorRef.current.wallTime + elapsed)
    const pad = (n) => String(n).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours(),
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`
  }

  return {
    dateTime: displayTime,
    mode,
    frozen,
    setMode: handleModeChange,
    setFrozen: handleFrozenChange,
    setDateTime: handleDateTimeChange,
    getCommitDateTime,
  }
}
