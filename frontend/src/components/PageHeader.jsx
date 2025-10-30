import React from 'react'
import { useTheme } from '../ThemeContext.jsx'

const PageHeader = ({ title, onBack, onRefresh, onCreate, isDark, children }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <h1 style={{ marginTop: 0, marginBottom: 0 }}>{title}</h1>
      <div style={{ display: 'flex', gap: 8 }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', cursor: 'pointer', background: isDark ? '#0b0f16' : '#fff', color: isDark ? '#e5e7eb' : '#111827' }}
          >
            ← Dashboard
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', background: isDark ? '#1f2937' : '#111827', color: 'white' }}
          >
            Refresh
          </button>
        )}
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', background: isDark ? '#1f2937' : '#111827', color: 'white' }}
          >
            + Create
          </button>
        )}
        {children}
      </div>
    </div>
  )
}

export default PageHeader