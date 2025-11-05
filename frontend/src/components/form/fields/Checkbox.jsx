import React from 'react'
import { useTheme } from '../../../ThemeContext.jsx'

export default function Checkbox({ form, name, label, disabled, validators, ...rest }) {
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'
  const reg = form.register(name, { validators, type: 'checkbox' })
  const error = form.errors[name]

  const labelStyle = { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }
  const errStyle = { color: 'crimson', marginTop: 4, fontSize: 12 }

  return (
    <div>
      <label style={labelStyle}>
        <input type="checkbox" disabled={disabled} {...reg} {...rest} />
        <span>{label}</span>
      </label>
      {error && <div style={errStyle}>{error}</div>}
    </div>
  )
}
