import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
import { plantsApi } from '../api/plants'
import { locationsApi } from '../api/locations'

export default function PlantEdit() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [activeTab, setActiveTab] = useState('general')

  const initialPlant = useMemo(() => location.state?.plant || null, [location.state])
  const [loading, setLoading] = useState(!initialPlant)
  const [error, setError] = useState('')

  function normalize(p) {
    if (!p) return p
    return {
      ...p,
      description: p.description ?? '',
      photo_url: p.photo_url ?? '',
      default_measurement_method_id: p.default_measurement_method_id ?? '',
      species_name: p.species_name ?? p.species ?? '',
      botanical_name: p.botanical_name ?? '',
      cultivar: p.cultivar ?? '',
      location_id: p.location_id ?? p.location ?? '',
      substrate_type_id: p.substrate_type_id ?? '',
      substrate_last_refresh_at: p.substrate_last_refresh_at ?? '',
      fertilized_last_at: p.fertilized_last_at ?? '',
      fertilizer_ec_ms: p.fertilizer_ec_ms ?? '',
      light_level_id: p.light_level_id ?? '',
      pest_status_id: p.pest_status_id ?? '',
      health_status_id: p.health_status_id ?? '',
    }
  }

  const [plant, setPlant] = useState(initialPlant ? normalize(initialPlant) : null)
  const [locations, setLocations] = useState([])
  const [locLoading, setLocLoading] = useState(true)
  const [locError, setLocError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      if (plant) return
      setLoading(true)
      try {
        const data = await plantsApi.getByUuid(uuid, controller.signal)
        setPlant(normalize(data))
      } catch (e) {
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (!isAbort) setError('Failed to load plant')
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => {
      controller.abort()
    }
  }, [uuid, plant])

  useEffect(() => {
    let cancelled = false
    async function loadLocations() {
      try {
        const data = await locationsApi.list()
        if (!cancelled) setLocations(Array.isArray(data) ? data : [])
      } catch (e) {
        if (!cancelled) setLocError('Failed to load locations')
      } finally {
        if (!cancelled) setLocLoading(false)
      }
    }
    loadLocations()
    return () => { cancelled = true }
  }, [])

  function onChange(e) {
    const { name, value } = e.target
    setPlant((prev) => ({ ...prev, [name]: value }))
  }

  async function onSave(e) {
    e.preventDefault()
    if (!plant) return
    const trimmedName = (plant.name || '').trim() || plant.name
    const payload = {
      // General
      name: trimmedName,
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
    try {
      const idHex = plant.uuid
      if (!idHex) throw new Error('Missing plant id')
      const resData = await plantsApi.update(idHex, payload)
      // Navigate back to list; list will refresh from server
      navigate('/plants')
    } catch (err) {
      window.alert(err.message || 'Failed to save')
    }
  }

  function onCancel(e) {
    e.preventDefault()
    navigate('/plants')
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
    <DashboardLayout title="Edit Plant">
      <h1 style={{ marginTop: 0 }}>Edit Plant</h1>
      <p>
        <Link to="/plants">← Back to Plants</Link>
      </p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}

      {!loading && !error && plant && (
        <form onSubmit={onSave} style={boxStyle}>
          <div style={tabsWrap} role="tablist" aria-label="Edit plant tabs">
            <button type="button" role="tab" aria-selected={activeTab === 'general'} onClick={() => setActiveTab('general')} style={tabBtn(activeTab === 'general')}>General</button>
            <button type="button" role="tab" aria-selected={activeTab === 'advanced'} onClick={() => setActiveTab('advanced')} style={tabBtn(activeTab === 'advanced')}>Advanced</button>
            <button type="button" role="tab" aria-selected={activeTab === 'health'} onClick={() => setActiveTab('health')} style={tabBtn(activeTab === 'health')}>Health</button>
          </div>

          {activeTab === 'general' && (
            <div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="name">Name</label>
                <input id="name" name="name" value={plant.name || ''} onChange={onChange} style={inputStyle} required />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="description">Description</label>
                <textarea id="description" name="description" value={plant.description || ''} onChange={onChange} style={{...inputStyle, minHeight: 90, resize: 'vertical'}} placeholder="Optional notes" />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="location_id">Location</label>
                <select id="location_id" name="location_id" value={plant.location_id || ''} onChange={onChange} style={inputStyle} disabled={locLoading}>
                  <option value="">— Select location —</option>
                  {locations.map((loc) => (
                    <option key={loc.uuid} value={loc.uuid}>{loc.name}</option>
                  ))}
                </select>
                {locError && <div style={{ color: 'crimson', marginTop: 6 }}>{locError}</div>}
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="photo_url">Photo URL</label>
                <input id="photo_url" name="photo_url" value={plant.photo_url || ''} onChange={onChange} style={inputStyle} placeholder="https://..." />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="default_measurement_method_id">Default Measurement Method ID</label>
                <input id="default_measurement_method_id" name="default_measurement_method_id" value={plant.default_measurement_method_id || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>
            </div>
          )}

          {activeTab === 'advanced' && (
            <div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="species_name">Species name</label>
                <input id="species_name" name="species_name" value={plant.species_name || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="botanical_name">Botanical name</label>
                <input id="botanical_name" name="botanical_name" value={plant.botanical_name || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="cultivar">Cultivar</label>
                <input id="cultivar" name="cultivar" value={plant.cultivar || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="substrate_type_id">Substrate Type ID</label>
                <input id="substrate_type_id" name="substrate_type_id" value={plant.substrate_type_id || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="substrate_last_refresh_at">Substrate Last Refresh At</label>
                <input id="substrate_last_refresh_at" name="substrate_last_refresh_at" type="datetime-local" value={plant.substrate_last_refresh_at || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="fertilized_last_at">Fertilized Last At</label>
                <input id="fertilized_last_at" name="fertilized_last_at" type="datetime-local" value={plant.fertilized_last_at || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="fertilizer_ec_ms">Fertilizer EC (mS)</label>
                <input id="fertilizer_ec_ms" name="fertilizer_ec_ms" type="number" step="0.01" value={plant.fertilizer_ec_ms ?? ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>

              <div style={{...rowStyle, marginTop: 22, paddingTop: 10, borderTop: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`}}>
                <div style={labelStyle}>ID</div>
                <div>{plant.id}</div>
              </div>

              <div style={rowStyle}>
                <div style={labelStyle}>Created</div>
                <DateTimeText as="div" value={plant.created_at} />
              </div>
            </div>
          )}

          {activeTab === 'health' && (
            <div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="light_level_id">Light Level ID</label>
                <input id="light_level_id" name="light_level_id" value={plant.light_level_id || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="pest_status_id">Pest Status ID</label>
                <input id="pest_status_id" name="pest_status_id" value={plant.pest_status_id || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="health_status_id">Health Status ID</label>
                <input id="health_status_id" name="health_status_id" value={plant.health_status_id || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={{ ...btn, background: isDark ? '#1f2937' : '#111827', color: 'white' }}>Save</button>
            <button type="button" onClick={onCancel} style={{ ...btn, background: 'transparent', borderColor: isDark ? '#374151' : '#d1d5db' }}>Cancel</button>
          </div>
        </form>
      )}
    </DashboardLayout>
  )
}
