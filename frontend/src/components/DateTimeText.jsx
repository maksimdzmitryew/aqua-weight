import React from 'react'
import { formatDateTime } from '../utils/datetime.js'

// Reusable display component for consistent date/time formatting across the app.
// Respects the user preference stored in localStorage (key: 'dtFormat').
// - value: Date | number (ms) | string (ISO or SQL) | null | undefined
// - empty: string to show when value is empty or invalid
// - as: element to render (span/div)
export default function DateTimeText({ value, empty = '—', as: As = 'span', title, className, ...rest }) {
  const text = formatDateTime(value)
  const isEmpty = !value || !text || text === String(value)
  const titleAttr = title !== undefined ? title : (value ? String(value) : undefined)
  return (
    <As className={className} title={titleAttr} {...rest}>
      {isEmpty ? empty : text}
    </As>
  )
}
