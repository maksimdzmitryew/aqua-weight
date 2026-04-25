import React from 'react'

/**
 * Chip - A pill-styled toggle/action component.
 * Can be used as a radio button or a simple button.
 */
export default function Chip({ label, selected, onClick, disabled }) {
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 12px',
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid',
    transition: 'all 0.2s ease',
    opacity: disabled ? 0.5 : 1,
    userSelect: 'none',

    // Theme-aware colors (can be further refined if we had access to full theme)
    background: selected ? '#111827' : 'transparent',
    color: selected ? '#ffffff' : '#374151',
    borderColor: selected ? '#111827' : '#d1d5db',
  }

  return (
    <div
      role="button"
      aria-pressed={selected}
      onClick={disabled ? undefined : onClick}
      style={style}
    >
      {label}
    </div>
  )
}
