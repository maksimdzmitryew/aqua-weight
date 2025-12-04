import React from 'react'
import { useTheme } from '../ThemeContext.jsx'

// Simple, non-interactive status icon to indicate actionable tasks
// type: 'measure' | 'water'
// active: boolean — whether the action is suggested/needed
export default function StatusIcon({ type, active, label }) {
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  // High-contrast palette
  const bgActive = type === 'water'
    ? (isDark ? '#1d4ed8' : '#1d4ed8') // strong blue
    : (isDark ? '#16a34a' : '#16a34a') // strong green

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

  const title = label || (type === 'water' ? (active ? 'Needs watering' : 'No watering needed') : (active ? 'Needs measurement' : 'No measurement needed'))

  return (
    <span role="img" aria-label={title} title={title} style={containerStyle}>
      {type === 'water' ? (
        // Filled droplet for better legibility
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12 2.5S6 9 6 13a6 6 0 1 0 12 0c0-4-6-10.5-6-10.5z"/>
        </svg>
      ) : (
        // Simplified filled beaker/flask
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M14 3h1a1 1 0 1 1 0 2v4.2l4.07 6.52c.9 1.45-.12 3.28-1.85 3.28H6.78c-1.73 0-2.75-1.83-1.85-3.28L9 9.2V5a1 1 0 0 1 0-2h1v2h4V3zM8 15h8v2H8v-2z"/>
        </svg>
      )}
    </span>
  )
}
