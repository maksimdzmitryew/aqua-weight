import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'
import { locationsApi } from '../api/locations'

export default function LocationCreate() {
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [loc, setLoc] = useState({ name: '', description: '' })
  const [fieldErrors, setFieldErrors] = useState({})

  function onChange(e) {
    const { name, value } = e.target
    setLoc((prev) => ({ ...prev, [name]: value }))
    if (fieldErrors[name]) setFieldErrors((prev) => ({ ...prev, [name]: '' }))
  }

  function onCancel(e) {
    e.preventDefault()
    navigate('/locations')
  }

  async function onSave(e) {
    e.preventDefault()
    const name = (loc.name || '').trim()
    if (!name) {
      setFieldErrors({ name: 'Name is required' })
      return
    }
    try {
      setFieldErrors({})
      await locationsApi.create({ name, description: (loc.description || '').trim() || null })
      navigate('/locations')
    } catch (err) {
      const msg = err?.message || 'Failed to save'
      // naive mapping for 409 already exists, rely on backend messages
      setFieldErrors({ name: msg })
    }
  }

  const labelStyle = { display: 'block', fontWeight: 600, marginBottom: 6 }
  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
    background: isDark ? '#0b1220' : 'white',
    color: isDark ? '#e5e7eb' : '#111827',
    boxSizing: 'border-box',
  }
  const textareaStyle = { ...inputStyle, minHeight: 90, resize: 'vertical' }

  const rowStyle = { marginBottom: 14 }
  const boxStyle = {
    maxWidth: 640,
    background: isDark ? '#0d1628' : '#ffffff',
    border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
    borderRadius: 8,
    padding: 16,
  }
  const btn = {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid transparent',
    cursor: 'pointer',
  }

  return (
    <DashboardLayout title="Create New Location">
      <h1 style={{ marginTop: 0 }}>Create New Location</h1>
      <p>
        <Link to="/locations">← Back to Locations</Link>
      </p>

      <form onSubmit={onSave} style={boxStyle}>
        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="name">Name</label>
          <input
            id="name"
            name="name"
            value={loc.name}
            onChange={onChange}
            style={{
              ...inputStyle,
              borderColor: fieldErrors.name ? 'crimson' : (isDark ? '#374151' : '#d1d5db'),
            }}
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            required
            placeholder="e.g., Living room shelf"
          />
          {fieldErrors.name && (
            <div id="name-error" style={{ color: 'crimson', marginTop: 6 }}>{fieldErrors.name}</div>
          )}
        </div>

        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="description">Description</label>
          <textarea id="description" name="description" value={loc.description} onChange={onChange} style={textareaStyle} placeholder="Optional notes about this location" />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" style={{ ...btn, background: isDark ? '#1f2937' : '#111827', color: 'white' }}>Save</button>
          <button type="button" onClick={onCancel} style={{ ...btn, background: 'transparent', borderColor: isDark ? '#374151' : '#d1d5db' }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}
