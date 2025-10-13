import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'

export default function PlantCreate() {
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [plant, setPlant] = useState({
    name: '',
    description: '',
    species_name: '',
    botanical_name: '',
    cultivar: '',
    location: '', // placeholder text field; DB expects location_id
    sort_order: 0,
    photo_url: '',
    fertilizer_ec_ms: '',
  })
  const [fieldErrors, setFieldErrors] = useState({})

  function onChange(e) {
    const { name, value, type } = e.target
    const v = name === 'sort_order' ? Number(value) : (type === 'number' ? Number(value) : value)
    setPlant((prev) => ({ ...prev, [name]: v }))
    if (fieldErrors[name]) setFieldErrors((prev) => ({ ...prev, [name]: '' }))
  }

  function onCancel(e) {
    e.preventDefault()
    navigate('/plants')
  }

  async function onSave(e) {
    e.preventDefault()
    const name = (plant.name || '').trim()
    if (!name) {
      setFieldErrors({ name: 'Name is required' })
      return
    }
    try {
      setFieldErrors({})
      const payload = {
        name,
        description: (plant.description || '').trim() || null,
        species_name: (plant.species_name || '').trim() || null,
        botanical_name: (plant.botanical_name || '').trim() || null,
        cultivar: (plant.cultivar || '').trim() || null,
        location: (plant.location || '').trim() || null,
        sort_order: Number(plant.sort_order) || 0,
        photo_url: (plant.photo_url || '').trim() || null,
        fertilizer_ec_ms: plant.fertilizer_ec_ms === '' ? null : Number(plant.fertilizer_ec_ms),
      }
      const res = await fetch('/api/plants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        let detail = ''
        try { const data = await res.json(); detail = (data && data.detail) || '' } catch (_) { try { detail = await res.text() } catch (_) { detail = '' } }
        if (res.status === 400) {
          setFieldErrors({ name: detail || 'Invalid name' })
          return
        }
        setFieldErrors({ name: detail || `Failed to save (HTTP ${res.status})` })
        return
      }
      navigate('/plants')
    } catch (err) {
      setFieldErrors({ name: err.message || 'Failed to save' })
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
    maxWidth: 720,
    background: isDark ? '#0d1628' : '#ffffff',
    border: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
    borderRadius: 8,
    padding: 16,
  }
  const btn = { padding: '8px 12px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer' }

  return (
    <DashboardLayout title="Create New Plant">
      <h1 style={{ marginTop: 0 }}>Create New Plant</h1>
      <p>
        <Link to="/plants">← Back to Plants</Link>
      </p>

      <form onSubmit={onSave} style={boxStyle}>
        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="name">Name</label>
          <input
            id="name"
            name="name"
            value={plant.name}
            onChange={onChange}
            style={{ ...inputStyle, borderColor: fieldErrors.name ? 'crimson' : (isDark ? '#374151' : '#d1d5db') }}
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            required
            placeholder="e.g., Monstera Deliciosa"
          />
          {fieldErrors.name && <div id="name-error" style={{ color: 'crimson', marginTop: 6 }}>{fieldErrors.name}</div>}
        </div>

        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="species_name">Species name</label>
          <input id="species_name" name="species_name" value={plant.species_name} onChange={onChange} style={inputStyle} placeholder="Optional" />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="botanical_name">Botanical name</label>
          <input id="botanical_name" name="botanical_name" value={plant.botanical_name} onChange={onChange} style={inputStyle} placeholder="Optional" />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="cultivar">Cultivar</label>
          <input id="cultivar" name="cultivar" value={plant.cultivar} onChange={onChange} style={inputStyle} placeholder="Optional" />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="location">Location</label>
          <input id="location" name="location" value={plant.location} onChange={onChange} style={inputStyle} placeholder="Free text for now (DB uses location_id)" />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="description">Description</label>
          <textarea id="description" name="description" value={plant.description} onChange={onChange} style={textareaStyle} placeholder="Optional notes" />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="photo_url">Photo URL</label>
          <input id="photo_url" name="photo_url" value={plant.photo_url} onChange={onChange} style={inputStyle} placeholder="https://..." />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="fertilizer_ec_ms">Fertilizer EC (mS)</label>
          <input id="fertilizer_ec_ms" name="fertilizer_ec_ms" type="number" step="0.01" value={plant.fertilizer_ec_ms} onChange={onChange} style={inputStyle} placeholder="Optional" />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle} htmlFor="sort_order">Sort order</label>
          <input id="sort_order" name="sort_order" type="number" value={plant.sort_order} onChange={onChange} style={inputStyle} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" style={{ ...btn, background: isDark ? '#1f2937' : '#111827', color: 'white' }}>Save</button>
          <button type="button" onClick={onCancel} style={{ ...btn, background: 'transparent', borderColor: isDark ? '#374151' : '#d1d5db' }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}
