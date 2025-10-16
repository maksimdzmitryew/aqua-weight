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

export default function WateringCreate() {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
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
  const [lastDryPrefilled, setLastDryPrefilled] = useState(false)
  // Track manual edits to avoid overwriting and to drive disable logic
  const [manualDry, setManualDry] = useState(false)
  const [manualWet, setManualWet] = useState(false)
  const [manualAdded, setManualAdded] = useState(false)
  // Track which fields were auto-computed in the current state
  const [computedDry, setComputedDry] = useState(false)
  const [computedWet, setComputedWet] = useState(false)
  const [computedAdded, setComputedAdded] = useState(false)
  // Suppress immediate auto-fill after user clears a field
  const [suppressAutoDry, setSuppressAutoDry] = useState(false)
  const [suppressAutoWet, setSuppressAutoWet] = useState(false)
  const [suppressAutoAdded, setSuppressAutoAdded] = useState(false)

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

  // Prefill last dry weight when plant changes (prefer measured_weight_g, else last_dry_weight_g)
  useEffect(() => {
    let cancelled = false
    async function fetchLast() {
      try {
        if (!plantId) {
          setLastDry('')
          setLastDryPrefilled(false)
          return
        }
        const res = await fetch(`/api/measurements/last?plant_id=${plantId}`)
        if (!res.ok) throw new Error('load failed')
        const data = await res.json()
        if (cancelled) return
        const mw = data?.measured_weight_g
        const ld = data?.last_dry_weight_g
        const val = (mw ?? null) != null ? mw : ((ld ?? null) != null ? ld : null)
        if (val != null) {
          setLastDry(String(val))
          setLastDryPrefilled(true)
          setManualDry(false)
          setComputedDry(false)
        } else {
          setLastDry('')
          setLastDryPrefilled(false)
          setManualDry(false)
          setComputedDry(false)
        }
      } catch (_) {
        if (!cancelled) {
          // On error, do not prefill
          setLastDryPrefilled(false)
        }
      }
    }
    fetchLast()
    return () => { cancelled = true }
  }, [plantId])

  // Disable logic per spec (with preference to keep manually-entered fields enabled)
  const hasDry = lastDry !== ''
  const hasWet = lastWet !== ''
  const hasAdded = waterAdded !== ''

  let disableAdded = false, disableWet = false, disableDry = false

  if (hasDry && hasAdded) {
    // When user enters Added with Dry present, keep Added enabled and disable Wet
    if (manualAdded) {
      disableWet = true
      disableAdded = false
    } else if (manualWet) {
      disableAdded = true
    } else if (computedWet) {
      disableWet = true
    } else {
      // Default: disable Wet (third value) when computed from Dry+Added
      disableWet = true
    }
  } else if (hasDry && hasWet) {
    if (manualWet) {
      disableAdded = true
    } else if (manualAdded) {
      // Wet likely computed from Dry+Added; keep Added editable
      disableWet = true
      disableAdded = false
    } else if (computedWet) {
      disableWet = true
    } else {
      // Default: disable Added (third value) when Dry+Wet are present
      disableAdded = true
    }
  } else if (hasWet && hasAdded) {
    if (manualAdded) {
      disableDry = true
    } else if (manualDry) {
      disableAdded = true
    } else if (computedDry) {
      disableDry = true
    } else {
      // Default: disable Dry (third value) when Wet+Added are present
      disableDry = true
    }
  }

  const disableDryInput = lastDryPrefilled || disableDry
  const dryLabel = (!lastDryPrefilled && !disableDryInput) ? 'Current dry weight (g)' : 'Last dry weight (g)'

  // Auto-calc values based on pairs, but never overwrite manually entered fields.
  // Recompute computed fields even if all three have values, so they stay in sync when sources change.
  useEffect(() => {
    // Compute Added from Dry + Wet
    if (hasDry && hasWet && !manualAdded && !suppressAutoAdded) {
      const v = Number(lastWet) - Number(lastDry)
      if (!Number.isNaN(v)) {
        setWaterAdded(String(Math.max(0, v)))
        setComputedAdded(true)
        setManualAdded(false)
      }
    }

    // Compute Wet from Dry + Added
    if (hasDry && hasAdded && !manualWet && !suppressAutoWet) {
      const v = Number(lastDry) + Number(waterAdded)
      if (!Number.isNaN(v)) {
        setLastWet(String(Math.max(0, v)))
        setComputedWet(true)
        setManualWet(false)
      }
    }

    // Compute Dry from Wet + Added
    if (hasWet && hasAdded && !manualDry && !suppressAutoDry) {
      const v = Number(lastWet) - Number(waterAdded)
      if (!Number.isNaN(v)) {
        setLastDry(String(Math.max(0, v)))
        setComputedDry(true)
        setManualDry(false)
      }
    }
  }, [hasDry, hasWet, hasAdded, lastDry, lastWet, waterAdded, manualAdded, manualWet, manualDry, suppressAutoAdded, suppressAutoWet, suppressAutoDry])

  const canSave = useMemo(() => plantId && measuredAt && (hasDry || hasWet || hasAdded), [plantId, measuredAt, hasDry, hasWet, hasAdded])

  async function onSubmit(e) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      const payload = {
        plant_id: plantId,
        measured_at: measuredAt,
        last_dry_weight_g: lastDry !== '' ? Number(lastDry) : null,
        last_wet_weight_g: lastWet !== '' ? Number(lastWet) : null,
        water_added_g: waterAdded !== '' ? Number(waterAdded) : 0,
      }
      const res = await fetch('/api/measurements', {
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
  const disabledInputStyle = isDark
    ? { background: '#1f2937', color: '#9ca3af' }
    : { background: '#f3f4f6', color: '#6b7280' }

  return (
    <DashboardLayout title="Watering">
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
            <label style={labelStyle}>{dryLabel}</label>
            <input
              disabled={disableDryInput}
              type="number"
              value={lastDry}
              onChange={(e)=>{ const v = e.target.value; setLastDry(v); if (v === '') { setManualDry(false); setSuppressAutoDry(true); if (computedWet) setLastWet(''); if (computedAdded) setWaterAdded(''); setComputedDry(false); setComputedWet(false); setComputedAdded(false); } else { setManualDry(true); setComputedDry(false); setSuppressAutoDry(false); if (waterAdded !== '' && lastWet === '' && !manualWet) { setSuppressAutoWet(false) } if (lastWet !== '' && waterAdded === '' && !manualAdded) { setSuppressAutoAdded(false) } } }}
              style={{...inputStyle, ...(disableDryInput ? disabledInputStyle : {})}}
              min={0}
            />
          </div>
          <div>
            <label style={labelStyle}>Current Wet weight (g)</label>
            <input
              disabled={disableWet}
              type="number"
              value={lastWet}
              onChange={(e)=>{ const v = e.target.value; setLastWet(v); if (v === '') { setManualWet(false); setSuppressAutoWet(true); if (computedAdded) setWaterAdded(''); if (computedDry) setLastDry(''); setComputedWet(false); setComputedAdded(false); setComputedDry(false); } else { setManualWet(true); setComputedWet(false); setSuppressAutoWet(false); if (lastDry !== '' && waterAdded === '' && !manualAdded) { setSuppressAutoAdded(false) } if (waterAdded !== '' && lastDry === '' && !manualDry) { setSuppressAutoDry(false) } } }}
              style={{...inputStyle, ...(disableWet ? disabledInputStyle : {})}}
              min={0}
            />
          </div>
          <div>
            <label style={labelStyle}>Water added (g)</label>
            <input
              disabled={disableAdded}
              type="number"
              value={waterAdded}
              onChange={(e)=>{ const v = e.target.value; setWaterAdded(v); if (v === '') { setManualAdded(false); setSuppressAutoAdded(true); if (computedWet) setLastWet(''); if (computedDry) setLastDry(''); setComputedAdded(false); setComputedWet(false); setComputedDry(false); } else { setManualAdded(true); setComputedAdded(false); setSuppressAutoAdded(false); if (lastDry !== '' && lastWet === '' && !manualWet) { setSuppressAutoWet(false) } if (lastWet !== '' && lastDry === '' && !manualDry) { setSuppressAutoDry(false) } } }}
              style={{...inputStyle, ...(disableAdded ? disabledInputStyle : {})}}
              min={0}
            />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button disabled={!canSave || saving} type="submit" style={{ padding: '8px 14px', borderRadius: 6 }}>Save watering</button>
          <button type="button" onClick={()=>navigate('/plants')} style={{ marginLeft: 8, padding: '8px 14px', borderRadius: 6 }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}
