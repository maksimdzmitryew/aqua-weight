import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
import { locationsApi } from '../api/locations'

export default function LocationEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const locationObj = useLocation()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const initialLocation = useMemo(() => locationObj.state?.location || null, [locationObj.state])
  const [loading, setLoading] = useState(!initialLocation)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [loc, setLoc] = useState(initialLocation)
  const [originalName, setOriginalName] = useState(initialLocation?.name || '')
  const numericId = Number(id)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      if (loc) return
      setLoading(true)
      try {
        const data = await locationsApi.list(controller.signal)
        const found = (Array.isArray(data) ? data : []).find((l) => l.id === numericId)
        if (!found) throw new Error('Location not found')
        setLoc(found)
        setOriginalName(found.name || '')
      } catch (e) {
        setError(e?.message || 'Failed to load location')
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => {
      controller.abort()
    }
  }, [numericId, loc])

  function onChange(e) {
    const { name, value } = e.target
    setLoc((prev) => ({ ...prev, [name]: value }))
    // Clear field-level error as user edits
    setFieldErrors((prev) => (prev && prev[name] ? { ...prev, [name]: '' } : prev))
  }

  async function onSave(e) {
    e.preventDefault()
    const newName = (loc.name || '').trim()
    if (!newName) {
      setFieldErrors({ name: 'Name cannot be empty' })
      setError('')
      return
    }

    try {
      setError('')
      setFieldErrors({})
      try {
        await locationsApi.updateByName(originalName || loc.name, newName)
      } catch (e) {
        const msg = e?.detail || e?.message || 'Failed to save'
        // Map known validation/conflict to field error
        if (e?.status === 400 || e?.status === 409) {
          setFieldErrors({ name: msg })
          return
        }
        setError(msg)
        return
      }
      // Optimistically navigate back with updated state for UI
      const trimmed = { ...loc, name: newName }
      navigate('/locations', { state: { updatedLocation: trimmed } })
    } catch (err) {
      setError(err.message || 'Failed to save location')
    }
  }

  function onCancel(e) {
    e.preventDefault()
    navigate('/locations')
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
    <DashboardLayout title="Edit Location">
      <h1 style={{ marginTop: 0 }}>Edit Location</h1>
      <p>
        <Link to="/locations">← Back to Locations</Link>
      </p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}

      {!loading && !error && loc && (
        <form onSubmit={onSave} style={boxStyle}>
          <div style={rowStyle}>
            <div style={labelStyle}>ID</div>
            <div>{loc.id}</div>
          </div>

          <div style={rowStyle}>
            <label style={labelStyle} htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              value={loc.name || ''}
              onChange={onChange}
              style={{
                ...inputStyle,
                borderColor: fieldErrors.name ? 'crimson' : (isDark ? '#374151' : '#d1d5db'),
              }}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? 'name-error' : undefined}
              required
            />
            {fieldErrors.name && (
              <div id="name-error" style={{ color: 'crimson', marginTop: 6 }}>{fieldErrors.name}</div>
            )}
          </div>

          <div style={rowStyle}>
            <label style={labelStyle} htmlFor="type">Type</label>
            <input id="type" name="type" value={loc.type || ''} onChange={onChange} style={inputStyle} placeholder="Optional" />
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>Created</div>
            <DateTimeText as="div" value={loc.created_at} />
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
