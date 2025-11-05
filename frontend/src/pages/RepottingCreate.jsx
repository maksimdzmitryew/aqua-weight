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

const RepottingCreate = () => {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
  const editId = search.get('id') // Check for 'id' parameter in search query
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'
  
  const [plants, setPlants] = useState([])
  const [plantId, setPlantId] = useState(preselect || '')
  const [measuredAt, setMeasuredAt] = useState(nowLocalValue())
  const [lastWet, setLastWet] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [weightBeforeRepotting, setWeightBeforeRepotting] = useState('') // Rename lastDryWeightBeforeRepotting to weightBeforeRepotting

  const isEdit = !!editId

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
    let cancelled = false
    async function loadRepottingEvent() {
      if (!isEdit) return
      try {
        const data = await measurementsApi.repotting.get(editId)
        if (cancelled) return
        setPlantId(data.plant_id)
        setMeasuredAt(data.measured_at)
        setWeightBeforeRepotting(String(data.weight_before_repotting_g))
        setLastWet(String(data.last_wet_weight_g))
      } catch (_) {
        if (!cancelled) setError('Failed to load repotting event')
      }
    }
    loadRepottingEvent()
    return () => { cancelled = true }
  }, [isEdit, editId])

  useEffect(() => {
    if (preselect) setPlantId(preselect)
  }, [preselect])

  // Update the canSave useMemo hook
  const canSave = useMemo(() => plantId && measuredAt && lastWet !== '' && weightBeforeRepotting !== '', [plantId, measuredAt, lastWet, weightBeforeRepotting])

  async function onSubmit(e) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      const payload = {
        plant_id: plantId,
        measured_at: measuredAt,
        measured_weight_g: weightBeforeRepotting !== '' ? Number(weightBeforeRepotting) : null,
        last_wet_weight_g: lastWet !== '' ? Number(lastWet) : null,
      }
      if (isEdit) {
        await measurementsApi.repotting.update(editId, payload)
      } else {
        await measurementsApi.repotting.create(payload)
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
    <DashboardLayout title="Repotting">
      <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
        {error && <div style={{ color: 'tomato', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Plant</label>
            <select value={plantId} onChange={(e)=>setPlantId(e.target.value)} style={inputStyle}>
              <option value="">Select plant…</option>
              {plants.map(p => (
                <option key={p.uuid} value={p.uuid}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Measured at</label>
            <input type="datetime-local" value={measuredAt} onChange={(e)=>setMeasuredAt(e.target.value)} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Weight before repotting (g)</label> {/* No need to rename the label as it already matches the new variable name */}
            <input type="number" value={weightBeforeRepotting} onChange={(e) => setWeightBeforeRepotting(e.target.value)} style={inputStyle} min={0} />
          </div>
          
          <div>
            <label style={labelStyle}>Weight after repotting (g)</label>
            <input type="number" value={lastWet} onChange={(e)=>setLastWet(e.target.value)} style={inputStyle} min={0} />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button disabled={!canSave || saving} type="submit" style={{ padding: '8px 14px', borderRadius: 6 }}>Save repotting</button>
          <button type="button" onClick={()=>navigate('/plants')} style={{ marginLeft: 8, padding: '8px 14px', borderRadius: 6 }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}

export default RepottingCreate