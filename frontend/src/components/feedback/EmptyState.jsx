import React from 'react'

/**
 * EmptyState
 * Minimal empty state with title/description and optional action node.
 * Props:
 * - title: string
 * - description?: string
 * - children?: ReactNode — can be an action button/link
 */
export default function EmptyState({ title, description, children }) {
  if (!title && !description) return null
  const style = {
    padding: 16,
    border: '1px dashed var(--border)',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--muted)'
  }
  return (
    <div role="note" style={style}>
      {title && <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: description ? 4 : 0 }}>{title}</div>}
      {description && <div style={{ marginBottom: children ? 8 : 0 }}>{description}</div>}
      {children}
    </div>
  )
}
