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

export default function RepottingCreate() {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [plants, setPlants] = useState([])
  const [plantId, setPlantId] = useState(preselect || '')
  const [measuredAt, setMeasuredAt] = useState(nowLocalValue())
  const [lastWet, setLastWet] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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

  const canSave = useMemo(() => plantId && measuredAt && lastWet !== '', [plantId, measuredAt, lastWet])

  async function onSubmit(e) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      const payload = {
        plant_id: plantId,
        measured_at: measuredAt,
        last_wet_weight_g: lastWet !== '' ? Number(lastWet) : null,
      }
      const res = await fetch('/api/events/repotting', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      })
      if (!res.ok) {
        let detail = ''
        try { const d = await res.json(); detail = d?.detail || '' } catch { try { detail = await res.text() } catch { detail = '' } }
        throw new Error(detail || `Save failed (HTTP ${res.status})`)
      }
      navigate('/plants')
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
            <label style={labelStyle}>Last wet weight (g)</label>
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
