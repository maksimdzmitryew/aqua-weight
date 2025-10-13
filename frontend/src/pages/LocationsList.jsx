import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { formatDateTime } from '../utils/datetime.js'

export default function LocationsList() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  return (
    <DashboardLayout title="Locations">
      <h1 style={{ marginTop: 0 }}>Locations</h1>
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
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id}>
                  <td style={td}>{l.id}</td>
                  <td style={td}>{l.name}</td>
                  <td style={td}>{l.type || '—'}</td>
                  <td style={td}>{formatDateTime(l.created_at)}</td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr>
                  <td style={td} colSpan={4}>No locations found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  )
}

const th = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid #e5e7eb',
  background: '#f9fafb',
  fontWeight: 600,
}

const td = {
  padding: '8px 10px',
  borderBottom: '1px solid #f3f4f6',
}

