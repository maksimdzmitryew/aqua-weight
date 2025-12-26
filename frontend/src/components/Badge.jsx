import React from 'react'

export default function Badge({ children, tone = 'neutral', title }) {
  const tones = {
    neutral: { bg: '#f3f4f6', fg: '#374151', border: '#e5e7eb' },
    success: { bg: '#ecfdf5', fg: '#065f46', border: '#a7f3d0' },
    warning: { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' },
    danger: { bg: '#fef2f2', fg: '#991b1b', border: '#fecaca' },
  }
  const t = tones[tone] || tones.neutral
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 6px',
    borderRadius: 999,
    fontSize: 12,
    lineHeight: 1.2,
    background: t.bg,
    color: t.fg,
    border: `1px solid ${t.border}`,
    whiteSpace: 'nowrap',
  }
  return (
    <span role="status" aria-live="polite" title={title} style={style}>
      {children}
    </span>
  )
}
