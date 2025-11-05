import React from 'react'

/**
 * ErrorNotice
 * Standardized error message with optional retry action.
 * Props:
 * - message: string
 * - onRetry?: () => void
 * - inline?: boolean
 */
export default function ErrorNotice({ message, onRetry, inline = false }) {
  if (!message) return null
  const style = {
    display: inline ? 'inline-flex' : 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    border: '1px solid var(--border)',
    background: 'var(--error-bg, #fee2e2)',
    color: 'var(--text)',
    borderRadius: 6,
  }
  return (
    <div role="alert" style={style}>
      <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Error:</span>
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry} style={{ marginLeft: 'auto' }}>
          Retry
        </button>
      )}
    </div>
  )
}
