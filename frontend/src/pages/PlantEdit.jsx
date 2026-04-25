import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
import { plantsApi } from '../api/plants'
import { locationsApi } from '../api/locations'
import { referenceApi } from '../api/reference'
import { toLocalISOMinutes } from '../utils/datetime'

export function buildUpdatePayload(plant) {
  if (!plant) throw new Error('Missing plant')
  const trimmedName = (plant.name || '').trim() || plant.name
  const payload = {
    // General
    name: trimmedName,
    plant_type: (plant.plant_type || '').trim() || null,
    identify_hint: (plant.identify_hint || '').trim() || null,
    typical_action: (plant.typical_action || '').trim() || null,
    description: (plant.description || '').trim() || null,
    notes: (plant.notes || '').trim() || null,
    location_id: (plant.location_id || '').trim() || null,
    photo_url: (plant.photo_url || '').trim() || null,
    // Service
    default_measurement_method_id: (plant.default_measurement_method_id || '').trim() || null,
    scale_id: (plant.scale_id || '').trim() || null,
    sort_order: plant.sort_order === '' ? 0 : Number(plant.sort_order),
    repotted: plant.repotted ? 1 : 0,
    archive: plant.archive ? 1 : 0,
    // Care
    recommended_water_threshold_pct:
      plant.recommended_water_threshold_pct === '' || plant.recommended_water_threshold_pct == null
        ? null
        : Number(plant.recommended_water_threshold_pct),
    biomass_weight_g:
      plant.biomass_weight_g === '' || plant.biomass_weight_g == null
        ? null
        : Number(plant.biomass_weight_g),
    biomass_last_at: (plant.biomass_last_at || '').trim() || null,
    // Advanced
    species_name: (plant.species_name || '').trim() || null,
    botanical_name: (plant.botanical_name || '').trim() || null,
    cultivar: (plant.cultivar || '').trim() || null,
    substrate_type_id: (plant.substrate_type_id || '').trim() || null,
    substrate_last_refresh_at: (plant.substrate_last_refresh_at || '').trim() || null,
    fertilized_last_at: (plant.fertilized_last_at || '').trim() || null,
    fertilizer_ec_ms:
      plant.fertilizer_ec_ms === '' || plant.fertilizer_ec_ms == null
        ? null
        : Number(plant.fertilizer_ec_ms),
    // Health
    light_level_id: (plant.light_level_id || '').trim() || null,
    pest_status_id: (plant.pest_status_id || '').trim() || null,
    health_status_id: (plant.health_status_id || '').trim() || null,
    // Calculated
    min_dry_weight_g:
      plant.min_dry_weight_g === '' || plant.min_dry_weight_g == null
        ? null
        : Number(plant.min_dry_weight_g),
    max_water_weight_g:
      plant.max_water_weight_g === '' || plant.max_water_weight_g == null
        ? null
        : Number(plant.max_water_weight_g),
  }
  const idHex = plant.uuid
  if (!idHex) throw new Error('Missing plant id')
  return { idHex, payload }
}

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
      plant_type: p.plant_type ?? '',
      identify_hint: p.identify_hint ?? '',
      typical_action: p.typical_action ?? '',
      description: p.description ?? '',
      notes: p.notes ?? '',
      photo_url: p.photo_url ?? '',
      default_measurement_method_id: p.default_measurement_method_id ?? '',
      scale_id: p.scale_id ?? '',
      sort_order: p.sort_order ?? 0,
      repotted: p.repotted ?? 0,
      archive: p.archive ?? 0,
      biomass_weight_g: p.biomass_weight_g ?? '',
      biomass_last_at: toLocalISOMinutes(p.biomass_last_at),
      species_name: p.species_name ?? p.species ?? '',
      botanical_name: p.botanical_name ?? '',
      cultivar: p.cultivar ?? '',
      location_id: p.location_id ?? '',
      substrate_type_id: p.substrate_type_id ?? '',
      substrate_last_refresh_at: toLocalISOMinutes(p.substrate_last_refresh_at),
      fertilized_last_at: toLocalISOMinutes(p.fertilized_last_at),
      fertilizer_ec_ms: p.fertilizer_ec_ms ?? '',
      light_level_id: p.light_level_id ?? '',
      pest_status_id: p.pest_status_id ?? '',
      health_status_id: p.health_status_id ?? '',
      recommended_water_threshold_pct: p.recommended_water_threshold_pct ?? '',
      min_dry_weight_g: p.min_dry_weight_g ?? '',
      max_water_weight_g: p.max_water_weight_g ?? '',
    }
  }

  const [plant, setPlant] = useState(initialPlant ? normalize(initialPlant) : null)
  const [locations, setLocations] = useState([])
  const [refs, setRefs] = useState({
    substrateTypes: [],
    lightLevels: [],
    pestStatuses: [],
    healthStatuses: [],
    scales: [],
    methods: [],
  })
  const [locLoading, setLocLoading] = useState(true)
  const [refsLoading, setRefsLoading] = useState(true)
  const [locError, setLocError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      try {
        const data = await plantsApi.getByUuid(uuid, controller.signal)
        setPlant(normalize(data))
        setLoading(false)
      } catch (e) {
        /* c8 ignore next */
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (isAbort) return
        setError('Failed to load plant')
        setLoading(false)
      }
    }
    load()
    return () => {
      controller.abort()
    }
  }, [uuid])

  useEffect(() => {
    let cancelled = false
    async function loadRefs() {
      try {
        const [locs, substrates, lights, pests, healths, scales, methods] = await Promise.all([
          locationsApi.list(),
          referenceApi.listSubstrateTypes(),
          referenceApi.listLightLevels(),
          referenceApi.listPestStatuses(),
          referenceApi.listHealthStatuses(),
          referenceApi.listScales(),
          referenceApi.listMethods(),
        ])
        if (!cancelled) {
          setLocations(Array.isArray(locs) ? locs : [])
          setRefs({
            substrateTypes: Array.isArray(substrates) ? substrates : [],
            lightLevels: Array.isArray(lights) ? lights : [],
            pestStatuses: Array.isArray(pests) ? pests : [],
            healthStatuses: Array.isArray(healths) ? healths : [],
            scales: Array.isArray(scales) ? scales : [],
            methods: Array.isArray(methods) ? methods : [],
          })
        }
      } catch (e) {
        if (!cancelled) setLocError('Failed to load reference data')
      } finally {
        if (!cancelled) {
          setLocLoading(false)
          setRefsLoading(false)
        }
      }
    }
    loadRefs()
    return () => {
      cancelled = true
    }
  }, [])

  function onChange(e) {
    const { name, value, type, checked } = e.target
    let v = value
    if (type === 'checkbox') {
      v = checked ? 1 : 0
    } else if (type === 'number') {
      v = value === '' ? null : Number(value)
    }
    setPlant((prev) => ({ ...prev, [name]: v }))
    if (fieldErrors[name]) setFieldErrors((prev) => ({ ...prev, [name]: '' }))
  }

  async function onSave(e) {
    e.preventDefault()
    try {
      setFieldErrors({})
      const built = buildUpdatePayload(plant)
      await plantsApi.update(built.idHex, built.payload)
      // Navigate back to list; list will refresh from server
      navigate('/plants')
    } catch (err) {
      if (err.response && err.response.data && err.response.data.detail) {
        const errorData = err.response.data
        const errors = {}
        if (Array.isArray(errorData.detail)) {
          errorData.detail.forEach((e) => {
            if (e.loc && e.loc.length > 0) {
              const fieldName = e.loc[e.loc.length - 1]
              errors[fieldName] = e.msg || 'Invalid value'
            }
          })
        } else {
          errors.general = errorData.detail
        }
        setFieldErrors(errors)
      } else {
        setFieldErrors({ general: err.message || 'Failed to save' })
      }
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
  const tabsWrap = {
    display: 'flex',
    gap: 8,
    borderBottom: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
    marginBottom: 16,
  }
  const tabBtn = (active) => ({
    ...btn,
    background: active ? (isDark ? '#111827' : '#111827') : 'transparent',
    color: active ? 'white' : isDark ? '#9ca3af' : '#374151',
    borderColor: active ? 'transparent' : isDark ? '#374151' : '#d1d5db',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  })

  return (
    <DashboardLayout title="Edit Plant">
      <h1 style={{ marginTop: 0 }}>Edit Plant</h1>
      <p>
        <Link to="/plants">← Back to Plants</Link>
      </p>

      {loading && <div>Loading...</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}

      {!loading && !error && plant && (
        <form onSubmit={onSave} style={boxStyle}>
          <div style={tabsWrap} role="tablist" aria-label="Edit plant tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
              style={tabBtn(activeTab === 'general')}
            >
              General
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'service'}
              onClick={() => setActiveTab('service')}
              style={tabBtn(activeTab === 'service')}
            >
              Service
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'care'}
              onClick={() => setActiveTab('care')}
              style={tabBtn(activeTab === 'care')}
            >
              Care
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'advanced'}
              onClick={() => setActiveTab('advanced')}
              style={tabBtn(activeTab === 'advanced')}
            >
              Advanced
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'health'}
              onClick={() => setActiveTab('health')}
              style={tabBtn(activeTab === 'health')}
            >
              Health
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'calculated'}
              onClick={() => setActiveTab('calculated')}
              style={tabBtn(activeTab === 'calculated')}
            >
              Calculated
            </button>
          </div>

          {activeTab === 'general' && (
            <div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="name">
                  Name *
                </label>
                <input
                  id="name"
                  name="name"
                  value={plant.name || ''}
                  onChange={onChange}
                  style={inputStyle}
                  required
                  placeholder="e.g., Monstera Deliciosa"
                />
                {fieldErrors.name && (
                  <div style={{ color: 'crimson', marginTop: 4, fontSize: '0.9em' }}>
                    {fieldErrors.name}
                  </div>
                )}
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="plant_type">
                  Plant Type
                </label>
                <input
                  id="plant_type"
                  name="plant_type"
                  value={plant.plant_type || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="identify_hint">
                  Identify Hint
                </label>
                <input
                  id="identify_hint"
                  name="identify_hint"
                  value={plant.identify_hint || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="typical_action">
                  Typical Action
                </label>
                <input
                  id="typical_action"
                  name="typical_action"
                  value={plant.typical_action || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="description">
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  value={plant.description || ''}
                  onChange={onChange}
                  style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="notes">
                  Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  value={plant.notes || ''}
                  onChange={onChange}
                  style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="location_id">
                  Location
                </label>
                <select
                  id="location_id"
                  name="location_id"
                  value={plant.location_id || ''}
                  onChange={onChange}
                  style={inputStyle}
                  disabled={locLoading}
                >
                  <option value="">— Select location —</option>
                  {locations.map((loc) => (
                    <option key={loc.uuid} value={loc.uuid}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                {locError && <div style={{ color: 'crimson', marginTop: 6 }}>{locError}</div>}
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="photo_url">
                  Photo URL
                </label>
                <input
                  id="photo_url"
                  name="photo_url"
                  value={plant.photo_url || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="https://..."
                />
              </div>
            </div>
          )}

          {activeTab === 'service' && (
            <div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="default_measurement_method_id">
                  Default Measurement Method
                </label>
                <select
                  id="default_measurement_method_id"
                  name="default_measurement_method_id"
                  value={plant.default_measurement_method_id || ''}
                  onChange={onChange}
                  style={inputStyle}
                  disabled={refsLoading}
                >
                  <option value="">— Select method —</option>
                  {refs.methods.map((m) => (
                    <option key={m.uuid} value={m.uuid}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="scale_id">
                  Scale
                </label>
                <select
                  id="scale_id"
                  name="scale_id"
                  value={plant.scale_id || ''}
                  onChange={onChange}
                  style={inputStyle}
                  disabled={refsLoading}
                >
                  <option value="">— Select scale —</option>
                  {refs.scales.map((s) => (
                    <option key={s.uuid} value={s.uuid}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="sort_order">
                  Sort Order
                </label>
                <input
                  id="sort_order"
                  name="sort_order"
                  type="number"
                  value={plant.sort_order}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="0"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="repotted">
                  Repotted
                </label>
                <input
                  id="repotted"
                  name="repotted"
                  type="checkbox"
                  checked={!!plant.repotted}
                  onChange={onChange}
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="archive">
                  Archive
                </label>
                <input
                  id="archive"
                  name="archive"
                  type="checkbox"
                  checked={!!plant.archive}
                  onChange={onChange}
                />
              </div>
            </div>
          )}

          {activeTab === 'care' && (
            <div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="recommended_water_threshold_pct">
                  Recommended Water Threshold (%)
                </label>
                <input
                  id="recommended_water_threshold_pct"
                  name="recommended_water_threshold_pct"
                  type="number"
                  value={plant.recommended_water_threshold_pct}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="biomass_weight_g">
                  Biomass Weight (g)
                </label>
                <input
                  id="biomass_weight_g"
                  name="biomass_weight_g"
                  type="number"
                  value={plant.biomass_weight_g}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="biomass_last_at">
                  Biomass Last At
                </label>
                <input
                  id="biomass_last_at"
                  name="biomass_last_at"
                  type="datetime-local"
                  value={plant.biomass_last_at || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>
            </div>
          )}

          {activeTab === 'advanced' && (
            <div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="species_name">
                  Species name
                </label>
                <input
                  id="species_name"
                  name="species_name"
                  value={plant.species_name || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="botanical_name">
                  Botanical name
                </label>
                <input
                  id="botanical_name"
                  name="botanical_name"
                  value={plant.botanical_name || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="cultivar">
                  Cultivar
                </label>
                <input
                  id="cultivar"
                  name="cultivar"
                  value={plant.cultivar || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="substrate_type_id">
                  Substrate Type
                </label>
                <select
                  id="substrate_type_id"
                  name="substrate_type_id"
                  value={plant.substrate_type_id || ''}
                  onChange={onChange}
                  style={inputStyle}
                  disabled={refsLoading}
                >
                  <option value="">— Select substrate —</option>
                  {refs.substrateTypes.map((s) => (
                    <option key={s.uuid} value={s.uuid}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="substrate_last_refresh_at">
                  Substrate Last Refresh At
                </label>
                <input
                  id="substrate_last_refresh_at"
                  name="substrate_last_refresh_at"
                  type="datetime-local"
                  value={plant.substrate_last_refresh_at || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="fertilized_last_at">
                  Fertilized Last At
                </label>
                <input
                  id="fertilized_last_at"
                  name="fertilized_last_at"
                  type="datetime-local"
                  value={plant.fertilized_last_at || ''}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="fertilizer_ec_ms">
                  Fertilizer EC (mS)
                </label>
                <input
                  id="fertilizer_ec_ms"
                  name="fertilizer_ec_ms"
                  type="number"
                  step="0.01"
                  value={plant.fertilizer_ec_ms}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div
                style={{
                  ...rowStyle,
                  marginTop: 22,
                  paddingTop: 10,
                  borderTop: `1px solid ${isDark ? '#1f2937' : '#e5e7eb'}`,
                }}
              >
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
                <label style={labelStyle} htmlFor="light_level_id">
                  Light Level
                </label>
                <select
                  id="light_level_id"
                  name="light_level_id"
                  value={plant.light_level_id || ''}
                  onChange={onChange}
                  style={inputStyle}
                  disabled={refsLoading}
                >
                  <option value="">— Select light level —</option>
                  {refs.lightLevels.map((l) => (
                    <option key={l.uuid} value={l.uuid}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="pest_status_id">
                  Pest Status
                </label>
                <select
                  id="pest_status_id"
                  name="pest_status_id"
                  value={plant.pest_status_id || ''}
                  onChange={onChange}
                  style={inputStyle}
                  disabled={refsLoading}
                >
                  <option value="">— Select pest status —</option>
                  {refs.pestStatuses.map((s) => (
                    <option key={s.uuid} value={s.uuid}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="health_status_id">
                  Health Status
                </label>
                <select
                  id="health_status_id"
                  name="health_status_id"
                  value={plant.health_status_id || ''}
                  onChange={onChange}
                  style={inputStyle}
                  disabled={refsLoading}
                >
                  <option value="">— Select health status —</option>
                  {refs.healthStatuses.map((s) => (
                    <option key={s.uuid} value={s.uuid}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {activeTab === 'calculated' && (
            <div>
              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="min_dry_weight_g">
                  Min Dry Weight (g)
                </label>
                <input
                  id="min_dry_weight_g"
                  name="min_dry_weight_g"
                  type="number"
                  value={plant.min_dry_weight_g}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>

              <div style={rowStyle}>
                <label style={labelStyle} htmlFor="max_water_weight_g">
                  Max Water Weight (g)
                </label>
                <input
                  id="max_water_weight_g"
                  name="max_water_weight_g"
                  type="number"
                  value={plant.max_water_weight_g}
                  onChange={onChange}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </div>
            </div>
          )}

          {fieldErrors.general && (
            <div style={{ color: 'crimson', marginBottom: 14 }}>{fieldErrors.general}</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              style={{ ...btn, background: isDark ? '#1f2937' : '#111827', color: 'white' }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={onCancel}
              style={{
                ...btn,
                background: 'transparent',
                borderColor: isDark ? '#374151' : '#d1d5db',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </DashboardLayout>
  )
}
