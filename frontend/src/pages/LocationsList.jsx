import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { formatDateTime } from '../utils/datetime.js'
import { useTheme } from '../ThemeContext.jsx'
import IconButton from '../components/IconButton.jsx'
import { useLocation as useRouterLocation, useNavigate } from 'react-router-dom'

export default function LocationsList() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'
  const navigate = useNavigate()
  const routerLocation = useRouterLocation()

  const th = {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb',
    background: isDark ? '#111827' : '#f9fafb',
    color: isDark ? '#e5e7eb' : '#111827',
    fontWeight: 600,
  }

  const td = {
    padding: '8px 10px',
    borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6',
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/locations')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setLocations(data)
      } catch (e) {
        if (!cancelled) setError('Failed to load locations')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const updated = routerLocation.state && routerLocation.state.updatedLocation
    if (updated) {
      setLocations((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
      try {
        window.history.replaceState({}, document.title, routerLocation.pathname)
      } catch {}
    }
  }, [routerLocation.state, routerLocation.pathname])

  function handleView(l) {
    const details = `Location #${l.id}\nName: ${l.name}\nType: ${l.type || '—'}\nCreated: ${formatDateTime(l.created_at)}`
    window.alert(details)
  }

  function handleEdit(l) {
    navigate(`/locations/${l.id}/edit`, { state: { location: l } })
  }

  function handleDelete(l) {
    if (!window.confirm(`Delete location "${l.name}"? This cannot be undone.`)) return
    setLocations((prev) => prev.filter((it) => it.id !== l.id))
  }

  return (
    <DashboardLayout title="Locations">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Locations</h1>
        <button
          type="button"
          onClick={() => navigate('/locations/new')}
          style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', background: isDark ? '#1f2937' : '#111827', color: 'white' }}
        >
          + Create
        </button>
      </div>
      <p>List of all available locations fetched from the API.</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}

      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Name</th>
                <th style={th}>Type</th>
                <th style={th}>Created</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id}>
                  <td style={td}>{l.id}</td>
                  <td style={td}>{l.name}</td>
                  <td style={td}>{l.type || '—'}</td>
                  <td style={td}>{formatDateTime(l.created_at)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <IconButton icon="view" label={`View location ${l.name}`} onClick={() => handleView(l)} variant="ghost" />
                    <IconButton icon="edit" label={`Edit location ${l.name}`} onClick={() => handleEdit(l)} variant="subtle" />
                    <IconButton icon="delete" label={`Delete location ${l.name}`} onClick={() => handleDelete(l)} variant="danger" />
                  </td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr>
                  <td style={td} colSpan={5}>No locations found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  )
}

