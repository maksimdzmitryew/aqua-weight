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
  // Controls
  const [showOnlyNonZero, setShowOnlyNonZero] = useState(false)
  const [showLastWatering, setShowLastWatering] = useState(true)

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
          {/* Filters */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showOnlyNonZero}
                onChange={(e) => setShowOnlyNonZero(e.target.checked)}
              />
              <span>zero Underwatering, all</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showLastWatering}
                onChange={(e) => setShowLastWatering(e.target.checked)}
              />
              <span>zero Underwatering, last</span>
            </label>
          </div>

          {items.map((p) => {
            const entries = p?.calibration?.max_water_retained || []
            // Entries are provided in DESC order by measured_at from the backend.
            // Toggle behavior inverted per requirement:
            // - When unchecked (showOnlyNonZero === false): hide zero-Underwatering rows
            // - When checked (showOnlyNonZero === true): show all rows including zeros
            let filtered = showOnlyNonZero
              ? entries
              : entries.filter((it) => it?.under_g !== 0)
            if (showLastWatering && entries.length > 0 && !filtered.includes(entries[0])) {
              // Ensure the latest watering is visible even if filtered out by non-zero filter.
              filtered = [entries[0], ...filtered]
            }
            if (filtered.length === 0) return null
            return (
              <div key={p.uuid || p.id} className="card" style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {p.name}
                    </div>
                    <div style={{ color: 'var(--muted-fg)' }}>{p.location || '—'}</div>
                    {/* Calibration summary values shown after plant name */}
                    {(() => {
                      const min = p?.min_dry_weight_g
                      const maxWater = p?.max_water_weight_g
                      const maxWeight = (typeof min === 'number' && typeof maxWater === 'number')
                        ? (min + maxWater)
                        : null
                      const fmt = (v) => (typeof v === 'number' ? `${v}g` : '—')
                      return (
                        <div style={{ color: 'var(--muted-fg)', marginTop: 2 }}>
                          <span>Minimum Weight: {fmt(min)}</span>
                          <span> • Maximum Water: {fmt(maxWater)}</span>
                          <span> • Maximum Weight: {fmt(maxWeight)}</span>
                        </div>
                      )
                    })()}
                  </div>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Measured at</th>
                        <th style={{ textAlign: 'right' }}>Water added (g)</th>
                        <th style={{ textAlign: 'right' }}>Last wet (g)</th>
                        <th style={{ textAlign: 'right' }}>Diff to max Weight (g)</th>
                        <th style={{ textAlign: 'right' }}>Below Max Water (g)</th>
                        <th style={{ textAlign: 'right' }}>(%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((it, idx) => (
                        <tr key={idx}>
                          <td>{it.measured_at || '—'}</td>
                          <td style={{ textAlign: 'right' }}>{it.water_added_g ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>{it.last_wet_weight_g ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>{
                            (typeof it?.target_weight_g === 'number' && typeof it?.last_wet_weight_g === 'number')
                              ? (() => {
                                  const diff = it.last_wet_weight_g - it.target_weight_g
                                  return diff > 0 ? `+${diff}` : `${diff}`
                                })()
                              : '—'
                          }</td>
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
