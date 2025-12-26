import React, { useId } from 'react'

export default function SearchField({ value, onChange, placeholder = 'Search…', ariaLabel = 'Search', autoFocus = false }) {
  const id = useId()
  const inputStyle = {
    flex: 1,
    minWidth: 180,
    maxWidth: 420,
    appearance: 'none',
    padding: '8px 28px 8px 10px',
    borderRadius: 6,
    border: '1px solid #e5e7eb',
    background: '#fff',
    color: '#111827',
  }
  const wrapperStyle = { position: 'relative', display: 'inline-flex', alignItems: 'center', flex: 1 }
  const clearBtnStyle = {
    position: 'absolute',
    right: 6,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'transparent',
    border: 'none',
    padding: 4,
    cursor: value ? 'pointer' : 'default',
    color: '#6b7280',
  }

  return (
    <div style={wrapperStyle}>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        style={inputStyle}
      />
      <button
        type="button"
        onClick={() => value && onChange('')}
        aria-label="Clear search"
        title="Clear"
        style={clearBtnStyle}
        disabled={!value}
      >
        ×
      </button>
    </div>
  )
}
