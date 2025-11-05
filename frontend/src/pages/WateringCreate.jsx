import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTheme } from '../ThemeContext.jsx'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'

function nowLocalValue() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  return `${y}-${m}-${day}T${hh}:${mm}`
}

export default function WateringCreate() {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
  const editId = search.get('id')
  const isEdit = !!editId
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [plants, setPlants] = useState([])
  const [plantId, setPlantId] = useState(preselect || '')
  const [measuredAt, setMeasuredAt] = useState(nowLocalValue())
  const [lastDry, setLastDry] = useState('')
  const [lastWet, setLastWet] = useState('')
  const [waterAdded, setWaterAdded] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadPlants() {
      try {
        const data = await plantsApi.list()
        if (!cancelled) setPlants(Array.isArray(data) ? data : [])
      } catch (_) {
        if (!cancelled) setError('Failed to load plants')
      }
    }
    loadPlants()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (preselect) setPlantId(preselect)
  }, [preselect])

  // Load existing watering in edit mode (reuse this page for add/edit)
  useEffect(() => {
    let cancelled = false
    async function loadExisting() {
      if (!isEdit) return
      try {
        const data = await measurementsApi.getById(editId)
        if (cancelled) return
        if (data?.plant_id) setPlantId(data.plant_id)
        if (data?.measured_at) {
          const s = String(data.measured_at).replace(' ', 'T').slice(0, 16)
          setMeasuredAt(s)
        }
        setLastDry(data?.last_dry_weight_g != null ? String(data.last_dry_weight_g) : '')
        setLastWet(data?.last_wet_weight_g != null ? String(data.last_wet_weight_g) : '')
        setWaterAdded(data?.water_added_g != null ? String(data.water_added_g) : '')
      } catch (_) {
        // ignore
      }
    }
    loadExisting()
    return () => { cancelled = true }
  }, [isEdit, editId])

  // No real-time calculations or dynamic disabling — plain inputs only
  const canSave = useMemo(() => !!plantId && !!measuredAt, [plantId, measuredAt])

  async function onSubmit(e) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      const common = {
        measured_at: measuredAt,
        last_dry_weight_g: lastDry !== '' ? Number(lastDry) : null,
        last_wet_weight_g: lastWet !== '' ? Number(lastWet) : null,
        water_added_g: waterAdded !== '' ? Number(waterAdded) : null, 
      }
      const payload = isEdit ? common : { plant_id: plantId, ...common }
      if (isEdit) {
        await measurementsApi.watering.update(editId, payload)
      } else {
        await measurementsApi.watering.create(payload)
      }
      navigate(`/plants/${plantId}`)
    } catch (e) {
      setError(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const labelStyle = { display: 'block', marginBottom: 4, fontWeight: 600 }
  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 6,
    border: isDark ? '1px solid #374151' : '1px solid #d1d5db',
    background: isDark ? '#111827' : '#fff', color: isDark ? '#e5e7eb' : '#111827'
  }

  return (
    <DashboardLayout title={isEdit ? 'Edit Watering' : 'Watering'}>
      <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
        {error && <div style={{ color: 'tomato', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Measured at</label>
            <input type="datetime-local" value={measuredAt} onChange={(e)=>setMeasuredAt(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Plant</label>
            <select value={plantId} onChange={(e)=>setPlantId(e.target.value)} style={inputStyle} disabled={isEdit}>
              <option value="">Select plant…</option>
              {plants.map(p => (
                <option key={p.uuid} value={p.uuid}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Current weight (g)</label>
            <input
              type="number"
              value={lastWet}
              onChange={(e)=>setLastWet(e.target.value)}
              style={inputStyle}
              min={0}
            />
          </div>
          <div>
            <label style={labelStyle}>[optional] Weight before watering (g)</label>
            <input
              type="number"
              value={lastDry}
              onChange={(e)=>setLastDry(e.target.value)}
              style={inputStyle}
              min={0}
            />
          </div>
          <div>
          </div>
          <div>
            <label style={labelStyle}>[optional] Water added (g)</label>
            <input
              type="number"
              value={waterAdded}
              onChange={(e)=>setWaterAdded(e.target.value)}
              style={inputStyle}
              min={0}
            />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button disabled={!canSave || saving} type="submit" style={{ padding: '8px 14px', borderRadius: 6 }}>{isEdit ? 'Update watering' : 'Save watering'}</button>
          <button type="button" onClick={()=>navigate(document.referrer)} style={{ marginLeft: 8, padding: '8px 14px', borderRadius: 6 }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}
