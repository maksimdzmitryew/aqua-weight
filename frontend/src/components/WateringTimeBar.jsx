import React from 'react'
import Chip from './Chip.jsx'

/**
 * WateringTimeBar - Composite component for controlling the measurement timestamp.
 * Includes a datetime-local picker, a freeze checkbox, and mode selection chips.
 */
export default function WateringTimeBar({ wateringTime }) {
  const { dateTime, mode, frozen, setMode, setFrozen, setDateTime } = wateringTime

  return (
    <div
      className="watering-time-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '12px',
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        marginBottom: '16px',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label htmlFor="watering-time-picker" style={{ fontSize: '14px', fontWeight: 600 }}>
          Time:
        </label>
        <input
          id="watering-time-picker"
          type="datetime-local"
          step="1"
          value={dateTime}
          onChange={(e) => setDateTime(e.target.value)}
          disabled={mode === 'real-time' && !frozen} // Enabled in manual or when frozen
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid #d1d5db',
            fontSize: '14px',
          }}
        />
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        <input type="checkbox" checked={frozen} onChange={(e) => setFrozen(e.target.checked)} />
        Freeze
      </label>

      <div style={{ display: 'flex', gap: '8px' }}>
        <Chip
          label="real-time"
          selected={mode === 'real-time'}
          onClick={() => setMode('real-time')}
        />
        <Chip label="manual" selected={mode === 'manual'} onClick={() => setMode('manual')} />
      </div>
    </div>
  )
}
