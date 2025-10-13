import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'

export default function PlantCreate() {
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [activeTab, setActiveTab] = useState('general')

  const [plant, setPlant] = useState({
    // General
    name: '',
    description: '',
    location_id: '', // placeholder free text; DB expects ULID BINARY(16)
    photo_url: '',
    default_measurement_method_id: '',
    // Advanced
    species_name: '',
    botanical_name: '',
    cultivar: '',
    substrate_type_id: '',
    substrate_last_refresh_at: '',
    fertilized_last_at: '',
    fertilizer_ec_ms: '',
    // Health
    light_level_id: '',
    pest_status_id: '',
    health_status_id: '',
  })
  const [locations, setLocations] = useState([])
  const [locLoading, setLocLoading] = useState(true)
  const [locError, setLocError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/locations')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setLocations(data)
      } catch (e) {
        if (!cancelled) setLocError('Failed to load locations')
      } finally {
        if (!cancelled) setLocLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function onChange(e) {
    const { name, value, type } = e.target
    const v = type === 'number' ? Number(value) : value
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
      setActiveTab('general')
      setFieldErrors({ name: 'Name is required' })
      return
    }
    try {
      setFieldErrors({})
      const payload = {
        // General
        name,
        description: (plant.description || '').trim() || null,
        location_id: (plant.location_id || '').trim() || null,
        photo_url: (plant.photo_url || '').trim() || null,
        default_measurement_method_id: (plant.default_measurement_method_id || '').trim() || null,
        // Advanced
        species_name: (plant.species_name || '').trim() || null,
        botanical_name: (plant.botanical_name || '').trim() || null,
        cultivar: (plant.cultivar || '').trim() || null,
        substrate_type_id: (plant.substrate_type_id || '').trim() || null,
        substrate_last_refresh_at: (plant.substrate_last_refresh_at || '').trim() || null,
        fertilized_last_at: (plant.fertilized_last_at || '').trim() || null,
        fertilizer_ec_ms: plant.fertilizer_ec_ms === '' ? null : Number(plant.fertilizer_ec_ms),
        // Health
        light_level_id: (plant.light_level_id || '').trim() || null,
        pest_status_id: (plant.pest_status_id || '').trim() || null,
        health_status_id: (plant.health_status_id || '').trim() || null,
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
          setActiveTab('general')
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
  const tabsWrap = { display: 'flex', gap: 8, borderBottom: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`, marginBottom: 16 }
  const tabBtn = (active) => ({
    ...btn,
    background: active ? (isDark ? '#111827' : '#111827') : 'transparent',
    color: active ? 'white' : (isDark ? '#9ca3af' : '#374151'),
    borderColor: active ? 'transparent' : (isDark ? '#374151' : '#d1d5db'),
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  })

  return (
    <DashboardLayout title="Create New Plant">
      <h1 style={{ marginTop: 0 }}>Create New Plant</h1>
      <p>
        <Link to="/plants">← Back to Plants</Link>
      </p>

      <form onSubmit={onSave} style={boxStyle}>
        <div style={tabsWrap} role="tablist" aria-label="Create plant tabs">
          <button type="button" role="tab" aria-selected={activeTab === 'general'} onClick={() => setActiveTab('general')} style={tabBtn(activeTab === 'general')}>General</button>
          <button type="button" role="tab" aria-selected={activeTab === 'advanced'} onClick={() => setActiveTab('advanced')} style={tabBtn(activeTab === 'advanced')}>Advanced</button>
          <button type="button" role="tab" aria-selected={activeTab === 'health'} onClick={() => setActiveTab('health')} style={tabBtn(activeTab === 'health')}>Health</button>
        </div>

        {activeTab === 'general' && (
          <div>
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
              <label style={labelStyle} htmlFor="description">Description</label>
              <textarea id="description" name="description" value={plant.description} onChange={onChange} style={textareaStyle} placeholder="Optional notes" />
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="location_id">Location</label>
              <select id="location_id" name="location_id" value={plant.location_id} onChange={onChange} style={inputStyle} disabled={locLoading}>
                <option value="">— Select location —</option>
                {locations.map((loc) => (
                  <option key={loc.uuid} value={loc.uuid}>{loc.name}</option>
                ))}
              </select>
              {locError && <div style={{ color: 'crimson', marginTop: 6 }}>{locError}</div>}
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="photo_url">Photo URL</label>
              <input id="photo_url" name="photo_url" value={plant.photo_url} onChange={onChange} style={inputStyle} placeholder="https://..." />
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="default_measurement_method_id">Default Measurement Method ID</label>
              <input id="default_measurement_method_id" name="default_measurement_method_id" value={plant.default_measurement_method_id} onChange={onChange} style={inputStyle} placeholder="ULID or free text for now" />
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div>
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
              <label style={labelStyle} htmlFor="substrate_type_id">Substrate Type ID</label>
              <input id="substrate_type_id" name="substrate_type_id" value={plant.substrate_type_id} onChange={onChange} style={inputStyle} placeholder="ULID or free text for now" />
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="substrate_last_refresh_at">Substrate Last Refresh At</label>
              <input id="substrate_last_refresh_at" name="substrate_last_refresh_at" type="datetime-local" value={plant.substrate_last_refresh_at} onChange={onChange} style={inputStyle} placeholder="Optional" />
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="fertilized_last_at">Fertilized Last At</label>
              <input id="fertilized_last_at" name="fertilized_last_at" type="datetime-local" value={plant.fertilized_last_at} onChange={onChange} style={inputStyle} placeholder="Optional" />
            </div>

            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="fertilizer_ec_ms">Fertilizer EC (mS)</label>
              <input id="fertilizer_ec_ms" name="fertilizer_ec_ms" type="number" step="0.01" value={plant.fertilizer_ec_ms} onChange={onChange} style={inputStyle} placeholder="Optional" />
            </div>
          </div>
        )}

        {activeTab === 'health' && (
          <div>
            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="light_level_id">Light Level ID</label>
              <input id="light_level_id" name="light_level_id" value={plant.light_level_id} onChange={onChange} style={inputStyle} placeholder="ULID or free text for now" />
            </div>
            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="pest_status_id">Pest Status ID</label>
              <input id="pest_status_id" name="pest_status_id" value={plant.pest_status_id} onChange={onChange} style={inputStyle} placeholder="ULID or free text for now" />
            </div>
            <div style={rowStyle}>
              <label style={labelStyle} htmlFor="health_status_id">Health Status ID</label>
              <input id="health_status_id" name="health_status_id" value={plant.health_status_id} onChange={onChange} style={inputStyle} placeholder="ULID or free text for now" />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" style={{ ...btn, background: isDark ? '#1f2937' : '#111827', color: 'white' }}>Save</button>
          <button type="button" onClick={onCancel} style={{ ...btn, background: 'transparent', borderColor: isDark ? '#374151' : '#d1d5db' }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}
