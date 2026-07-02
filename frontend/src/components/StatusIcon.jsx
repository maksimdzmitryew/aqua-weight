import React from 'react'
import { useTheme } from '../ThemeContext.jsx'

// Simple, non-interactive status icon to indicate actionable tasks
// type: 'measure' | 'water'
// active: boolean — whether the action is suggested/needed
export default function StatusIcon({ type, active, label }) {
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  // High-contrast palette
  const bgActive =
    type === 'water'
      ? isDark
        ? '#1d4ed8'
        : '#1d4ed8' // strong blue
      : isDark
        ? '#16a34a'
        : '#16a34a' // strong green

  const bgInactive = isDark ? '#374151' : '#e5e7eb'
  const fgActive = '#ffffff'
  const fgInactive = isDark ? '#9ca3af' : '#374151'

  const containerStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 6,
    background: active ? bgActive : bgInactive,
    color: active ? fgActive : fgInactive,
    border: `1px solid ${isDark ? '#111827' : '#cbd5e1'}`,
    boxShadow: isDark ? 'inset 0 0 0 1px rgba(0,0,0,0.2)' : 'none',
  }

  const title =
    label ||
    (type === 'water'
      ? active
        ? 'Needs watering'
        : 'No watering needed'
      : active
        ? 'Needs measurement'
        : 'No measurement needed')

  return (
    <span role="img" aria-label={title} title={title} style={containerStyle}>
      {type === 'water' ? (
        // Waves for an unambiguous "water" metaphor (replaces the droplet)
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
      ) : (
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
      )}
    </span>
  )
}
