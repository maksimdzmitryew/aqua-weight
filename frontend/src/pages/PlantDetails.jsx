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
  const [measurements, setMeasurements] = useState([])
  const [measLoading, setMeasLoading] = useState(false)
  const [measError, setMeasError] = useState('')

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

  useEffect(() => {
    let cancelled = false
    async function loadMeasurements() {
      if (!uuid) return
      setMeasLoading(true)
      setMeasError('')
      try {
        const res = await fetch(`/api/plants/${uuid}/measurements`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setMeasurements(Array.isArray(data) ? data : [])
      } catch (e) {
        if (!cancelled) setMeasError('Failed to load measurements')
      } finally {
        if (!cancelled) setMeasLoading(false)
      }
    }
    loadMeasurements()
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
        <>
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

          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Measurements</h3>
            {measLoading && <div>Loading measurements…</div>}
            {measError && !measLoading && <div style={{ color: 'crimson' }}>{measError}</div>}
            {!measLoading && !measError && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>measured_at</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>measured_weight_g</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>last_dry_weight_g</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>last_wet_weight_g</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_added_g</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_loss_total_pct</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_loss_total_g</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_loss_day_pct</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_loss_day_g</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measurements.map((m, i) => (
                      <tr key={i}>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{formatDateTime(m.measured_at)}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.measured_weight_g ?? '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.last_dry_weight_g ?? '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.last_wet_weight_g ?? '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_added_g ?? 0}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_loss_total_pct != null ? `${m.water_loss_total_pct.toFixed?.(2) ?? m.water_loss_total_pct}%` : '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_loss_total_g ?? '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_loss_day_pct != null ? `${m.water_loss_day_pct.toFixed?.(2) ?? m.water_loss_day_pct}%` : '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_loss_day_g ?? '—'}</td>
                      </tr>
                    ))}
                    {measurements.length === 0 && (
                      <tr>
                        <td colSpan={9} style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>No measurements yet</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </DashboardLayout>
  )
}
