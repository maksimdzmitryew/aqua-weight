import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'
import { formatDateTime } from '../utils/datetime.js'

export default function PlantEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const initialPlant = useMemo(() => location.state?.plant || null, [location.state])
  const [loading, setLoading] = useState(!initialPlant)
  const [error, setError] = useState('')
  const [plant, setPlant] = useState(initialPlant)
  const numericId = Number(id)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (plant) return
      setLoading(true)
      try {
        const res = await fetch('/api/plants')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const found = data.find((p) => p.id === numericId)
        if (!found) throw new Error('Plant not found')
        if (!cancelled) setPlant(found)
      } catch (e) {
        if (!cancelled) setError('Failed to load plant')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [numericId, plant])

  function onChange(e) {
    const { name, value } = e.target
    setPlant((prev) => ({ ...prev, [name]: value }))
  }

  function onSave(e) {
    e.preventDefault()
    if (!plant) return
    const trimmed = {
      ...plant,
      name: (plant.name || '').trim() || plant.name,
      species: (plant.species || '').trim() || null,
      location: (plant.location || '').trim() || null,
    }
    // No backend to persist yet; navigate back to list with updated item in state
    navigate('/plants', { state: { updatedPlant: trimmed } })
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
          <div style={rowStyle}>
            <div style={labelStyle}>ID</div>
            <div>{plant.id}</div>
          </div>

          <div style={rowStyle}>
            <label style={labelStyle} htmlFor="name">Name</label>
            <input id="name" name="name" value={plant.name || ''} onChange={onChange} style={inputStyle} required />
          </div>

          <div style={rowStyle}>
            <label style={labelStyle} htmlFor="species">Species</label>
            <input id="species" name="species" value={plant.species || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
          </div>

          <div style={rowStyle}>
            <label style={labelStyle} htmlFor="location">Location</label>
            <input id="location" name="location" value={plant.location || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>Created</div>
            <div>{formatDateTime(plant.created_at)}</div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={{ ...btn, background: isDark ? '#1f2937' : '#111827', color: 'white' }}>Save</button>
            <button type="button" onClick={onCancel} style={{ ...btn, background: 'transparent', borderColor: isDark ? '#374151' : '#d1d5db' }}>Cancel</button>
          </div>
        </form>
      )}
    </DashboardLayout>
  )
}
