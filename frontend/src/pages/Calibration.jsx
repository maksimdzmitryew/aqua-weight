import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import EmptyState from '../components/feedback/EmptyState.jsx'
import { calibrationApi } from '../api/calibration'

export default function Calibration() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await calibrationApi.list(controller.signal)
        setItems(Array.isArray(data) ? data : [])
      } catch (e) {
        const isAbort = e?.name === 'AbortError'
        if (!isAbort) setError(e?.message || 'Failed to load calibration data')
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [])

  return (
    <DashboardLayout title="Calibration">
      <h1 style={{ marginTop: 0 }}>Calibration</h1>
      <p>Use this section to review watering events that did not reach 100% (min dry + max water retained) after repotting.</p>

      {loading && <Loader message="Loading plants…" />}
      {!loading && error && <ErrorNotice message={error} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState title="No plants found" subtitle="Create a plant to start calibrating." />
      )}
      {!loading && !error && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {items.map((p) => {
            const entries = p?.calibration?.max_water_retained || []
            // Hide watering events where Under (g) equals 0; keep null/undefined under_g
            const filtered = entries.filter(it => it?.under_g !== 0)
            if (filtered.length === 0) return null
            return (
              <div key={p.uuid || p.id} className="card" style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ color: 'var(--muted-fg)' }}>{p.location || '—'}</div>
                  </div>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Measured at</th>
                        <th style={{ textAlign: 'right' }}>Water added (g)</th>
                        <th style={{ textAlign: 'right' }}>Last wet (g)</th>
                        <th style={{ textAlign: 'right' }}>Target (g)</th>
                        <th style={{ textAlign: 'right' }}>Under (g)</th>
                        <th style={{ textAlign: 'right' }}>Under (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((it, idx) => (
                        <tr key={idx}>
                          <td>{it.measured_at || '—'}</td>
                          <td style={{ textAlign: 'right' }}>{it.water_added_g ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>{it.last_wet_weight_g ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>{it.target_weight_g ?? '—'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--danger-fg)' }}>{it.under_g ?? '—'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--danger-fg)' }}>{
                            typeof it.under_pct === 'number' ? Math.round(it.under_pct) : '—'
                          }</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </DashboardLayout>
  )
}
