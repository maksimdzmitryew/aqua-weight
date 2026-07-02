import React from 'react'
import { useTheme } from '../ThemeContext.jsx'

const ICONS = {
  view: (
    // Eye icon
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  ),
  edit: (
    // Pencil icon
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
    </svg>
  ),
  delete: (
    // Trash icon
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
    </svg>
  ),
  scale: (
    // Balance-scale icon (measurement / weight) — classic two-pan law scale
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v3"></path>
      <path d="M12 6l-5 9h10L12 6z"></path>
      <path d="M7 15a2 2 0 1 0 4 0"></path>
      <path d="M13 15a2 2 0 1 0 4 0"></path>
      <path d="M3 21h18"></path>
      <path d="M7 15l-4 6"></path>
      <path d="M17 15l4 6"></path>
    </svg>
  ),
  waves: (
    // Waves icon (watering)
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"></path>
      <path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"></path>
    </svg>
  ),
  pot: (
    // Pot icon (repotting) — a plant pot
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 8h8l-1 10a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2L8 8z"></path>
      <path d="M5 8h14"></path>
      <path d="M10 5h4"></path>
    </svg>
  ),
}

export default function IconButton({
  icon,
  label,
  onClick,
  variant = 'ghost',
  size = 28,
  disabled = false,
}) {
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
      style={{
        ...baseStyle,
        ...(stylesByVariant[variant] || {}),
        ...(disabled ? { opacity: 0.6 } : {}),
      }}
      onMouseOver={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
      onMouseOut={(e) => Object.assign(e.currentTarget.style, { filter: 'none' })}
    >
      {iconEl}
    </button>
  )
}
