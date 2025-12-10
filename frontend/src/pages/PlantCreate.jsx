import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'
import { locationsApi } from '../api/locations'
import { plantsApi } from '../api/plants'

export default function PlantCreate() {
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [activeTab, setActiveTab] = useState('general')

  const [plant, setPlant] = useState({
    // General
    name: '',
    plant_type: '',
    identify_hint: '',
    typical_action: '',
    description: '',
    notes: '',
    location_id: '', // placeholder free text; DB expects ULID BINARY(16)
    photo_url: '',
    // Service
    default_measurement_method_id: '',
    scale_id: '',
    sort_order: 0,
    // repotted: false,
    // archive: false,
    // Care
    recommended_water_threshold_pct: '',
    biomass_weight_g: '',
    biomass_last_at: '',
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
    // Calculated
    min_dry_weight_g: '',
    max_water_weight_g: '',
  })
  const [locations, setLocations] = useState([])
  const [locLoading, setLocLoading] = useState(true)
  const [locError, setLocError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await locationsApi.list()
        if (!cancelled) setLocations(Array.isArray(data) ? data : [])
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
    const { name, value, type, checked } = e.target
    const v = type === 'checkbox' ? checked : (type === 'number' ? Number(value) : value)
    setPlant((prev) => ({ ...prev, [name]: v }))
    if (fieldErrors[name]) setFieldErrors((prev) => ({ ...prev, [name]: '' }))
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
        // sort_order: Number(plant.sort_order),
        repotted: plant.repotted ? 1 : 0,
        archive: plant.archive ? 1 : 0,
        // Care
        recommended_water_threshold_pct: plant.recommended_water_threshold_pct === '' ? null : Number(plant.recommended_water_threshold_pct),
        biomass_weight_g: plant.biomass_weight_g === '' ? null : Number(plant.biomass_weight_g),
        biomass_last_at: (plant.biomass_last_at || '').trim() || null,
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
        // Calculated
        min_dry_weight_g: plant.min_dry_weight_g === '' ? null : Number(plant.min_dry_weight_g),
        max_water_weight_g: plant.max_water_weight_g === '' ? null : Number(plant.max_water_weight_g),
      }
      let saved = false
      try {
        await plantsApi.create(payload)
        saved = true
        navigate('/plants')
      } catch (e) {
        // Handle validation errors from backend
        if (e.response && e.response.data) {
          const errorData = e.response.data;
          if (errorData.detail) {
            // Handle Pydantic validation errors
            const errors = {};
            if (Array.isArray(errorData.detail)) {
              errorData.detail.forEach(err => {
                if (err.loc && err.loc.length > 0) {
                  const fieldName = err.loc[err.loc.length - 1];
                  errors[fieldName] = err.msg || 'Invalid value';
                }
              });
            }
            setFieldErrors(errors);
          } else {
            // Handle other errors
            setFieldErrors({ general: errorData.detail || 'Failed to save plant' });
          }
        } else {
          // If error happened after successful save (e.g., navigate throws),
          // bubble it to the outer catch to surface the real message.
          // Otherwise (pre-save API error without axios-like shape), show
          // the generic message here to preserve UX and existing tests.
          if (saved) throw e
          setFieldErrors({ general: 'Failed to save plant' })
        }
      }
    } catch (err) {
      setFieldErrors({ general: err.message || 'Failed to save plant' })
    }
  }

  return (
    <DashboardLayout title="Create New Plant">
      <h1 style={{ marginTop: 0 }}>Create New Plant</h1>
      <p>
        <Link to="/plants">← Back to Plants</Link>
      </p>

      <form onSubmit={onSave} style={{
        padding: '20px',
        backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5',
        borderRadius: '8px',
        border: isDark ? '1px solid #444' : '1px solid #ddd'
      }}>
        <div style={{
          display: 'flex',
          gap: '10px',
          marginBottom: '20px',
          flexWrap: 'wrap'
        }} role="tablist" aria-label="Create plant tabs">
          <button type="button" role="tab" aria-selected={activeTab === 'general'} onClick={() => setActiveTab('general')} style={{
            padding: '10px 15px',
            backgroundColor: activeTab === 'general' ? (isDark ? '#333' : '#ddd') : (isDark ? '#222' : '#eee'),
            border: '1px solid ' + (isDark ? '#444' : '#ccc'),
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDark ? '#fff' : '#000'
          }}>General</button>
          <button type="button" role="tab" aria-selected={activeTab === 'service'} onClick={() => setActiveTab('service')} style={{
            padding: '10px 15px',
            backgroundColor: activeTab === 'service' ? (isDark ? '#333' : '#ddd') : (isDark ? '#222' : '#eee'),
            border: '1px solid ' + (isDark ? '#444' : '#ccc'),
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDark ? '#fff' : '#000'
          }}>Service</button>
          <button type="button" role="tab" aria-selected={activeTab === 'care'} onClick={() => setActiveTab('care')} style={{
            padding: '10px 15px',
            backgroundColor: activeTab === 'care' ? (isDark ? '#333' : '#ddd') : (isDark ? '#222' : '#eee'),
            border: '1px solid ' + (isDark ? '#444' : '#ccc'),
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDark ? '#fff' : '#000'
          }}>Care</button>
          <button type="button" role="tab" aria-selected={activeTab === 'advanced'} onClick={() => setActiveTab('advanced')} style={{
            padding: '10px 15px',
            backgroundColor: activeTab === 'advanced' ? (isDark ? '#333' : '#ddd') : (isDark ? '#222' : '#eee'),
            border: '1px solid ' + (isDark ? '#444' : '#ccc'),
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDark ? '#fff' : '#000'
          }}>Advanced</button>
          <button type="button" role="tab" aria-selected={activeTab === 'health'} onClick={() => setActiveTab('health')} style={{
            padding: '10px 15px',
            backgroundColor: activeTab === 'health' ? (isDark ? '#333' : '#ddd') : (isDark ? '#222' : '#eee'),
            border: '1px solid ' + (isDark ? '#444' : '#ccc'),
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDark ? '#fff' : '#000'
          }}>Health</button>
          <button type="button" role="tab" aria-selected={activeTab === 'calculated'} onClick={() => setActiveTab('calculated')} style={{
            padding: '10px 15px',
            backgroundColor: activeTab === 'calculated' ? (isDark ? '#333' : '#ddd') : (isDark ? '#222' : '#eee'),
            border: '1px solid ' + (isDark ? '#444' : '#ccc'),
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDark ? '#fff' : '#000'
          }}>Calculated</button>
        </div>

        {activeTab === 'general' && (
          <div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="name">Name *</label>
              <input
                id="name"
                name="name"
                value={plant.name}
                onChange={onChange}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                  backgroundColor: isDark ? '#222' : '#fff',
                  color: isDark ? '#fff' : '#000'
                }}
                required
                placeholder="e.g., Monstera Deliciosa"
              />
              {fieldErrors.name && <div style={{ color: 'red', fontSize: '14px', marginTop: '5px' }}>{fieldErrors.name}</div>}
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="plant_type">Plant Type</label>
              <input id="plant_type" name="plant_type" value={plant.plant_type} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="identify_hint">Identify Hint</label>
              <input id="identify_hint" name="identify_hint" value={plant.identify_hint} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="typical_action">Typical Action</label>
              <input id="typical_action" name="typical_action" value={plant.typical_action} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="description">Description</label>
              <textarea id="description" name="description" value={plant.description} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000',
                minHeight: '100px'
              }} placeholder="Optional notes" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" value={plant.notes} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000',
                minHeight: '100px'
              }} placeholder="Optional notes" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="location_id">Location</label>
              <select id="location_id" name="location_id" value={plant.location_id} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} disabled={locLoading}>
                <option value="">— Select location —</option>
                {locations.map((loc) => (
                  <option key={loc.uuid} value={loc.uuid}>{loc.name}</option>
                ))}
              </select>
              {locError && <div style={{ color: 'red', fontSize: '14px', marginTop: '5px' }}>{locError}</div>}
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="photo_url">Photo URL</label>
              <input id="photo_url" name="photo_url" value={plant.photo_url} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="https://..." />
            </div>
          </div>
        )}

        {activeTab === 'service' && (
          <div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="default_measurement_method_id">Default Measurement Method ID</label>
              <input id="default_measurement_method_id" name="default_measurement_method_id" value={plant.default_measurement_method_id} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="ULID or free text for now" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="scale_id">Scale ID</label>
              <input id="scale_id" name="scale_id" value={plant.scale_id} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="ULID or free text for now" />
            </div>
{/*
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="sort_order">Sort Order</label>
              <input id="sort_order" name="sort_order" type="number" value={plant.sort_order} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="0" />
            </div>
*/}
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="repotted">Repotted</label>
              <input id="repotted" name="repotted" type="checkbox" checked={!!plant.repotted} onChange={onChange} style={{ width: 'auto' }} />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="archive">Archive</label>
              <input id="archive" name="archive" type="checkbox" checked={!!plant.archive} onChange={onChange} style={{ width: 'auto' }} />
            </div>
          </div>
        )}

        {activeTab === 'care' && (
          <div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="recommended_water_threshold_pct">Recommended Water Threshold (%)</label>
              <input id="recommended_water_threshold_pct" name="recommended_water_threshold_pct" type="number" value={plant.recommended_water_threshold_pct} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="biomass_weight_g">Biomass Weight (g)</label>
              <input id="biomass_weight_g" name="biomass_weight_g" type="number" value={plant.biomass_weight_g} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="biomass_last_at">Biomass Last At</label>
              <input id="biomass_last_at" name="biomass_last_at" type="datetime-local" value={plant.biomass_last_at} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="species_name">Species name</label>
              <input id="species_name" name="species_name" value={plant.species_name} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="botanical_name">Botanical name</label>
              <input id="botanical_name" name="botanical_name" value={plant.botanical_name} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="cultivar">Cultivar</label>
              <input id="cultivar" name="cultivar" value={plant.cultivar} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="substrate_type_id">Substrate Type ID</label>
              <input id="substrate_type_id" name="substrate_type_id" value={plant.substrate_type_id} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="ULID or free text for now" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="substrate_last_refresh_at">Substrate Last Refresh At</label>
              <input id="substrate_last_refresh_at" name="substrate_last_refresh_at" type="datetime-local" value={plant.substrate_last_refresh_at} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="fertilized_last_at">Fertilized Last At</label>
              <input id="fertilized_last_at" name="fertilized_last_at" type="datetime-local" value={plant.fertilized_last_at} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="fertilizer_ec_ms">Fertilizer EC (mS)</label>
              <input id="fertilizer_ec_ms" name="fertilizer_ec_ms" type="number" step="0.01" value={plant.fertilizer_ec_ms} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>
          </div>
        )}

        {activeTab === 'health' && (
          <div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="light_level_id">Light Level ID</label>
              <input id="light_level_id" name="light_level_id" value={plant.light_level_id} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="ULID or free text for now" />
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="pest_status_id">Pest Status ID</label>
              <input id="pest_status_id" name="pest_status_id" value={plant.pest_status_id} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="ULID or free text for now" />
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="health_status_id">Health Status ID</label>
              <input id="health_status_id" name="health_status_id" value={plant.health_status_id} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="ULID or free text for now" />
            </div>
          </div>
        )}

        {activeTab === 'calculated' && (
          <div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="min_dry_weight_g">Min Dry Weight (g)</label>
              <input id="min_dry_weight_g" name="min_dry_weight_g" type="number" value={plant.min_dry_weight_g} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: isDark ? '#fff' : '#000' }} htmlFor="max_water_weight_g">Max Water Weight (g)</label>
              <input id="max_water_weight_g" name="max_water_weight_g" type="number" value={plant.max_water_weight_g} onChange={onChange} style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid ' + (isDark ? '#444' : '#ccc'),
                backgroundColor: isDark ? '#222' : '#fff',
                color: isDark ? '#fff' : '#000'
              }} placeholder="Optional" />
            </div>
          </div>
        )}

        {fieldErrors.general && <div style={{ color: 'red', marginBottom: '15px' }}>{fieldErrors.general}</div>}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="submit" style={{
            padding: '10px 20px',
            backgroundColor: isDark ? '#333' : '#ddd',
            border: '1px solid ' + (isDark ? '#444' : '#ccc'),
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDark ? '#fff' : '#000'
          }}>Save</button>
          <button type="button" onClick={() => navigate('/plants')} style={{
            padding: '10px 20px',
            backgroundColor: isDark ? '#222' : '#eee',
            border: '1px solid ' + (isDark ? '#444' : '#ccc'),
            borderRadius: '4px',
            cursor: 'pointer',
            color: isDark ? '#fff' : '#000'
          }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}