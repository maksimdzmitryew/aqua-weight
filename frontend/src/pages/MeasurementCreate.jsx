import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTheme } from '../ThemeContext.jsx'

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

export default function MeasurementCreate() {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
  const editId = search.get('id')
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [plants, setPlants] = useState([])
  const [plantId, setPlantId] = useState(preselect || '')
  const [measuredAt, setMeasuredAt] = useState(nowLocalValue())
  const [measuredWeight, setMeasuredWeight] = useState('')
  const [methodId, setMethodId] = useState('')
  const [useLastMethod, setUseLastMethod] = useState(true)
  const [scaleId, setScaleId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isEdit = !!editId

  useEffect(() => {
    let cancelled = false
    async function loadPlants() {
      try {
        const res = await fetch('/api/plants')
        if (!res.ok) throw new Error('load failed')
        const data = await res.json()
        if (!cancelled) setPlants(data)
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

  // Load existing measurement in edit mode
  useEffect(() => {
    let cancelled = false
    async function loadExisting() {
      if (!isEdit) return
      try {
        const res = await fetch(`/api/measurements/${editId}`)
        if (!res.ok) throw new Error('load failed')
        const data = await res.json()
        if (cancelled) return
        if (data?.plant_id) setPlantId(data.plant_id)
        if (data?.measured_at) {
          // convert "YYYY-MM-DD HH:MM:SS" to datetime-local "YYYY-MM-DDTHH:MM"
          const s = String(data.measured_at).replace(' ', 'T').slice(0, 16)
          setMeasuredAt(s)
        }
        if (data?.measured_weight_g != null) setMeasuredWeight(String(data.measured_weight_g))
        if (data?.method_id) setMethodId(data.method_id)
        if (data?.use_last_method != null) setUseLastMethod(!!data.use_last_method)
        if (data?.scale_id) setScaleId(data.scale_id)
        if (data?.note != null) setNote(String(data.note))
      } catch (_) {
        // ignore for now
      }
    }
    loadExisting()
    return () => { cancelled = true }
  }, [isEdit, editId])

  const canSave = useMemo(() => {
    return plantId && measuredAt
  }, [plantId, measuredAt])

  async function onSubmit(e) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      const payload = {
        plant_id: plantId,
        measured_at: measuredAt,
        measured_weight_g: measuredWeight ? Number(measuredWeight) : null,
        method_id: methodId || null,
        use_last_method: !!useLastMethod,
        scale_id: scaleId || null,
        note: note || null,
      }
      const url = isEdit ? `/api/measurements/weight/${editId}` : '/api/measurements/weight'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        let detail = ''
        try { const d = await res.json(); detail = d?.detail || '' } catch { try { detail = await res.text() } catch { detail = '' } }
        throw new Error(detail || `Save failed (HTTP ${res.status})`)
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
    <DashboardLayout title={isEdit ? 'Edit Measurement' : 'New Measurement'}>
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
            <label style={labelStyle}>Measured weight (g)</label>
            <input type="number" value={measuredWeight} onChange={(e)=>setMeasuredWeight(e.target.value)} style={inputStyle} min={0} />
          </div>
          <div>
            <label style={labelStyle}>Use last method</label>
            <input type="checkbox" checked={useLastMethod} onChange={(e)=>setUseLastMethod(e.target.checked)} />
          </div>
          <div>
          </div>
          <div>
            <label style={labelStyle}>Method (optional, hex id)</label>
            <input type="text" value={methodId} onChange={(e)=>setMethodId(e.target.value)} style={inputStyle} placeholder="32-char hex" />
          </div>
          <div>
          </div>
          <div>
            <label style={labelStyle}>Scale (optional, hex id)</label>
            <input type="text" value={scaleId} onChange={(e)=>setScaleId(e.target.value)} style={inputStyle} placeholder="32-char hex" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Note</label>
            <textarea value={note} onChange={(e)=>setNote(e.target.value)} style={{...inputStyle, height: 100}} />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button disabled={!canSave || saving} type="submit" style={{ padding: '8px 14px', borderRadius: 6 }}>{isEdit ? 'Update measurement' : 'Save measurement'}</button>
          <button type="button" onClick={()=>navigate('/plants')} style={{ marginLeft: 8, padding: '8px 14px', borderRadius: 6 }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}
