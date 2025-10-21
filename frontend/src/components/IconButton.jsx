import React from 'react'
import { useTheme } from '../ThemeContext.jsx'

const ICONS = {
  view: (
    // Eye icon
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  ),
  edit: (
    // Pencil icon
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
    </svg>
  ),
  delete: (
    // Trash icon
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
    </svg>
  ),
  beaker: (
    // Beaker/Flask icon (measurement)
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6"></path>
      <path d="M10 3v6.5l-5.5 8.8A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.7L14 9.5V3"></path>
      <path d="M8 15h8"></path>
    </svg>
  ),
  droplet: (
    // Droplet icon (watering)
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5C12 2.5 6 9 6 13a6 6 0 1 0 12 0c0-4-6-10.5-6-10.5z"></path>
    </svg>
  ),
  box: (
    // Box icon (repotting)
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
      <path d="M3.27 6.96L12 12l8.73-5.04"></path>
      <path d="M12 22V12"></path>
    </svg>
  ),
}

export default function IconButton({ icon, label, onClick, variant = 'ghost', size = 28, disabled = false }) {
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: 6,
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: isDark ? '#e5e7eb' : '#111827',
    background: 'transparent',
    marginRight: 6,
  }

  const stylesByVariant = {
    ghost: {
      background: 'transparent',
      borderColor: 'transparent',
    },
    subtle: {
      background: isDark ? '#111827' : '#f3f4f6',
      borderColor: isDark ? '#1f2937' : '#e5e7eb',
    },
    primary: {
      background: isDark ? '#0b1324' : '#eef2ff',
      borderColor: isDark ? '#1d4ed8' : '#c7d2fe',
      color: isDark ? '#c7d2fe' : '#1e3a8a',
    },
    danger: {
      background: isDark ? '#2b0f14' : '#fef2f2',
      borderColor: isDark ? '#7f1d1d' : '#fecaca',
      color: isDark ? '#fecaca' : '#991b1b',
    },
  }

  const hoverStyle = disabled
    ? {}
    : {
        filter: 'brightness(0.95)',
      }

  const iconEl = ICONS[icon] || null

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={disabled ? undefined : onClick}
      style={{ ...baseStyle, ...(stylesByVariant[variant] || {}), ...(disabled ? { opacity: 0.6 } : {}) }}
      onMouseOver={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
      onMouseOut={(e) => Object.assign(e.currentTarget.style, { filter: 'none' })}
    >
      {iconEl}
    </button>
  )
}
