import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { formatDateTime } from '../utils/datetime.js'
import { useTheme } from '../ThemeContext.jsx'
import IconButton from '../components/IconButton.jsx'
import { useLocation as useRouterLocation, useNavigate } from 'react-router-dom'

export default function PlantsList() {
  const [plants, setPlants] = useState([])
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
        const res = await fetch('/api/plants')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setPlants(data)
      } catch (e) {
        if (!cancelled) setError('Failed to load plants')
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
    const updated = routerLocation.state && routerLocation.state.updatedPlant
    if (updated) {
      setPlants((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
      // clear navigation state to avoid reapplying on refresh/back
      try {
        window.history.replaceState({}, document.title, routerLocation.pathname)
      } catch {}
    }
  }, [routerLocation.state, routerLocation.pathname])

  function handleView(p) {
    const details = `Plant #${p.id}\nName: ${p.name}\nSpecies: ${p.species || '—'}\nLocation: ${p.location || '—'}\nCreated: ${formatDateTime(p.created_at)}`
    window.alert(details)
  }

  function handleEdit(p) {
    navigate(`/plants/${p.id}/edit`, { state: { plant: p } })
  }

  function handleDelete(p) {
    if (!window.confirm(`Delete plant "${p.name}"? This cannot be undone.`)) return
    setPlants((prev) => prev.filter((it) => it.id !== p.id))
  }

  return (
    <DashboardLayout title="Plants">
      <h1 style={{ marginTop: 0 }}>Plants</h1>
      <p>List of all available plants fetched from the API.</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}

      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Name</th>
                <th style={th}>Species</th>
                <th style={th}>Location</th>
                <th style={th}>Created</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plants.map((p) => (
                <tr key={p.id}>
                  <td style={td}>{p.id}</td>
                  <td style={td}>{p.name}</td>
                  <td style={td}>{p.species || '—'}</td>
                  <td style={td}>{p.location || '—'}</td>
                  <td style={td}>{formatDateTime(p.created_at)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <IconButton icon="view" label={`View plant ${p.name}`} onClick={() => handleView(p)} variant="ghost" />
                    <IconButton icon="edit" label={`Edit plant ${p.name}`} onClick={() => handleEdit(p)} variant="subtle" />
                    <IconButton icon="delete" label={`Delete plant ${p.name}`} onClick={() => handleDelete(p)} variant="danger" />
                  </td>
                </tr>
              ))}
              {plants.length === 0 && (
                <tr>
                  <td style={td} colSpan={6}>No plants found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  )
}

