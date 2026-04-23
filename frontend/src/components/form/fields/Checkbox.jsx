import React from 'react'

export default function Checkbox({ form, name, label, disabled, validators, required, ...rest }) {
  const reg = form.register(name, { validators, type: 'checkbox' })
  const error = form.errors[name]

  const labelStyle = { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }
  const errStyle = { color: 'crimson', marginTop: 4, fontSize: 12 }

  return (
    <div>
      <label htmlFor={name} style={labelStyle}>
        <input
          id={name}
          type="checkbox"
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${name}-error` : undefined}
          required={required}
          {...reg}
          {...rest}
        />
        <span>{label}</span>
      </label>
      {error && (
        <div id={`${name}-error`} style={errStyle}>
          {error}
        </div>
      )}
    </div>
  )
}
