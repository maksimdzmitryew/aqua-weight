import React, { useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation as useRouterLocation } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { formatDateTime } from '../utils/datetime.js'
import { useTheme } from '../ThemeContext.jsx'

export default function PlantDetails() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  const routerLocation = useRouterLocation()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [plant, setPlant] = useState(routerLocation.state?.plant || null)
  const [loading, setLoading] = useState(!routerLocation.state?.plant)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!uuid) { setError('Missing id'); setLoading(false); return }
      try {
        const res = await fetch(`/api/plants/${uuid}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setPlant(data)
      } catch (e) {
        if (!cancelled) setError('Failed to load plant')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (!plant) load()
    return () => { cancelled = true }
  }, [uuid])

  const box = {
    background: isDark ? '#0b0f16' : '#ffffff',
    border: isDark ? '1px solid #1f2937' : '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 16,
  }

  return (
    <DashboardLayout title={plant ? plant.name : 'Plant details'}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>{plant ? plant.name : 'Plant details'}</h1>
        <div>
          {plant?.uuid && (
            <button type="button" onClick={() => navigate(`/plants/${plant.uuid}/edit`, { state: { plant } })}
                    style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', background: isDark ? '#1f2937' : '#111827', color: 'white', marginRight: 8 }}>
              Edit
            </button>
          )}
          <button type="button" onClick={() => navigate('/plants')}
                  style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', cursor: 'pointer', background: isDark ? '#0b0f16' : '#fff', color: isDark ? '#e5e7eb' : '#111827' }}>
            ← Back
          </button>
        </div>
      </div>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}

      {plant && !loading && !error && (
        <div style={box}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 10, columnGap: 16 }}>
            <div style={{ fontWeight: 600 }}>Name</div>
            <div>{plant.name}</div>
            <div style={{ fontWeight: 600 }}>Description</div>
            <div>{plant.description || '—'}</div>
            <div style={{ fontWeight: 600 }}>Location</div>
            <div>{plant.location || '—'}</div>
            <div style={{ fontWeight: 600 }}>Created</div>
            <div>{formatDateTime(plant.created_at)}</div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
