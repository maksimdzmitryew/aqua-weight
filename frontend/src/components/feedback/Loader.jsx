import React from 'react'

/**
 * Loader
 * Small, reusable loading indicator with accessible semantics.
 * Props:
 * - label?: string (default: "Loading…")
 * - inline?: boolean (default: false) — if true, renders inline-flex; else block with spacing
 */
export default function Loader({ label = 'Loading…', inline = false }) {
  const style = {
    display: inline ? 'inline-flex' : 'flex',
    alignItems: 'center',
    gap: 8,
    color: 'var(--muted)'
  }
  const spinnerStyle = {
    width: 16,
    height: 16,
    border: '2px solid var(--border)',
    borderTopColor: 'var(--text)',
    borderRadius: '50%',
    animation: 'aw-spin 1s linear infinite'
  }
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={style}>
      <span style={spinnerStyle} />
      <span>{label}</span>
      <style>{`@keyframes aw-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
