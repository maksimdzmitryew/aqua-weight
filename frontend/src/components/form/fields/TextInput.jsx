import React from 'react'
import { useTheme } from '../../../ThemeContext.jsx'

export default function TextInput({ form, name, label, placeholder, disabled, required, validators, ...rest }) {
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'
  const reg = form.register(name, { validators })
  const error = form.errors[name]

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 6,
    border: error ? '1px solid crimson' : (isDark ? '1px solid #374151' : '1px solid #d1d5db'),
    background: isDark ? '#111827' : '#fff', color: isDark ? '#e5e7eb' : '#111827'
  }
  const labelStyle = { display: 'block', marginBottom: 4, fontWeight: 600 }
  const errStyle = { color: 'crimson', marginTop: 4, fontSize: 12 }

  return (
    <div>
      {label && <label style={labelStyle} htmlFor={name}>{label}</label>}
      <input id={name} type="text" placeholder={placeholder} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined} required={required} {...reg} {...rest} style={inputStyle} />
      {error && <div id={`${name}-error`} style={errStyle}>{error}</div>}
    </div>
  )
}
