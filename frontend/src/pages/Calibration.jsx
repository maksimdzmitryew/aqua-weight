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
  const [busyPlant, setBusyPlant] = useState('')
  // Controls
  // "underwatered" checkbox: when unchecked (default) show only rows where
  // Diff to max Weight (g) < 0. When checked, also show rows >= 0 (i.e., show all).
  const [underwatered, setUnderwatered] = useState(false)
  // Preserve existing control: when unchecked, hide rows where Below Max Water (g) is zero; when checked, show all
  const [showOnlyNonZero, setShowOnlyNonZero] = useState(false)
  const [showLastWatering, setShowLastWatering] = useState(false)

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

  async function handleCorrectOverfill(plant) {
    try {
      const plantId = plant.uuid || plant.id
      setBusyPlant(plantId)

      // Determine correction starting point per requirement:
      // pick the entry with the biggest negative "Diff to max Weight (g)"
      // i.e., minimal (last_wet_weight_g - target_weight_g) since last repotting.
      const entries = plant?.calibration?.max_water_retained || []
      let minDiffEntry = null
      for (const it of entries) {
        const hasNums = typeof it?.last_wet_weight_g === 'number' && typeof it?.target_weight_g === 'number'
        if (!hasNums) continue
        const diff = it.last_wet_weight_g - it.target_weight_g
        if (minDiffEntry == null || diff < (minDiffEntry.last_wet_weight_g - minDiffEntry.target_weight_g)) {
          minDiffEntry = it
        }
      }

      const payload = { plant_id: plantId, cap: 'capacity', edit_last_wet: true }
      if (minDiffEntry && minDiffEntry.measured_at) {
        // Use the min-diff event as the correction window start (from_ts)
        payload.from_ts = String(minDiffEntry.measured_at)
      }

      await calibrationApi.correct(payload)
      // refresh list
      setLoading(true)
      setError('')
      const data = await calibrationApi.list()
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e?.message || 'Failed to apply corrections')
    } finally {
      setLoading(false)
      setBusyPlant('')
    }
  }

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
                checked={underwatered}
                onChange={(e) => setUnderwatered(e.target.checked)}
              />
              <span>underwatered</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showOnlyNonZero}
                onChange={(e) => setShowOnlyNonZero(e.target.checked)}
              />
              <span>zero Below Max Water, all</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showLastWatering}
                onChange={(e) => setShowLastWatering(e.target.checked)}
              />
              <span>zero Below Max Water, last</span>
            </label>
          </div>

          {items.map((p) => {
            const entries = p?.calibration?.max_water_retained || []
            // Determine the single most negative Diff to max Weight (g) entry per plant
            let mostNegativeEntry = null
            let mostNegativeDiff = null
            for (const it of entries) {
              const a = it?.last_wet_weight_g
              const b = it?.target_weight_g
              if (typeof a !== 'number' || typeof b !== 'number') continue
              const diff = a - b
              if (diff < 0 && (mostNegativeDiff === null || diff < mostNegativeDiff)) {
                mostNegativeDiff = diff
                mostNegativeEntry = it
              }
            }
            // Entries are provided in DESC order by measured_at from the backend.
            // New filter behavior ("underwatered" checkbox):
            // - When unchecked (underwatered === false): show only rows with Diff to max Weight (g) < 0
            // - When checked  (underwatered === true): show all rows (also include >= 0)
            let filtered
            if (underwatered) {
              filtered = entries
            } else {
              filtered = entries.filter((it) => {
                const a = it?.last_wet_weight_g
                const b = it?.target_weight_g
                if (typeof a !== 'number' || typeof b !== 'number') return false
                const diff = a - b
                return diff < 0
              })
            }
            // Apply additional legacy filter: when unchecked, hide rows with 0 under_g
            if (!showOnlyNonZero) {
              filtered = filtered.filter((it) => it?.under_g !== 0)
            }
            if (showLastWatering && entries.length > 0) {
              const last = entries[0]
              // Only ensure visibility of the latest watering if its Below Max Water (g) is 0
              if (last?.under_g === 0 && !filtered.includes(last)) {
                filtered = [last, ...filtered]
              }
            }
            // Always ensure the single most negative Diff to max Weight (g) entry is visible
            // even when its "Below Max Water (g)" equals 0 and the zero filter would hide it.
            if (mostNegativeEntry) {
              const alreadyPresent = filtered.some((row) =>
                row === mostNegativeEntry || (
                  row?.measured_at === mostNegativeEntry?.measured_at &&
                  row?.last_wet_weight_g === mostNegativeEntry?.last_wet_weight_g &&
                  row?.target_weight_g === mostNegativeEntry?.target_weight_g
                )
              )
              if (!alreadyPresent) {
                filtered = [mostNegativeEntry, ...filtered]
              }
            }
            if (filtered.length === 0) return null

            // Ensure rows are sorted by "Measured at" in descending order, regardless of filtering/inclusions
            const parseMs = (v) => {
              if (!v) return 0
              // Normalize "YYYY-MM-DD HH:MM:SS" to ISO-like for reliable Date parsing
              const s = String(v).replace(' ', 'T')
              const t = Date.parse(s)
              return Number.isNaN(t) ? 0 : t
            }
            const sorted = [...filtered].sort((a, b) => {
              const ams = parseMs(a?.measured_at)
              const bms = parseMs(b?.measured_at)
              return bms - ams // DESC
            })
            return (
              <div key={p.uuid || p.id} className="card" style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontWeight: 600 }}>
                    {p.name}
                  </div>
                  <div style={{ color: 'var(--muted-fg)' }}>{p.location || '—'}</div>
                  {/* Summary line with the action button on the same row */}
                  {(() => {
                    const min = p?.min_dry_weight_g
                    const maxWater = p?.max_water_weight_g
                    const maxWeight = (typeof min === 'number' && typeof maxWater === 'number')
                      ? (min + maxWater)
                      : null
                    const fmt = (v) => (typeof v === 'number' ? `${v}g` : '—')
                    const plantId = p.uuid || p.id
                    const canCorrect = (p?.min_dry_weight_g != null) && (p?.max_water_weight_g != null)
                    return (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--muted-fg)', marginTop: 2, gap: 8 }}>
                        <div>
                          <span>Minimum Weight: {fmt(min)}</span>
                          <span> • Maximum Water: {fmt(maxWater)}</span>
                          <span> • Maximum Weight: {fmt(maxWeight)}</span>
                        </div>
                        <button
                          className="button"
                          disabled={!canCorrect || busyPlant === plantId}
                          onClick={() => handleCorrectOverfill(p)}
                        >
                          {busyPlant === plantId ? 'Correcting…' : 'Correct overfill (since repotting)'}
                        </button>
                      </div>
                    )
                  })()}
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
                      {sorted.map((it, idx) => {
                        const hasNums = typeof it?.target_weight_g === 'number' && typeof it?.last_wet_weight_g === 'number'
                        const diffVal = hasNums ? (it.last_wet_weight_g - it.target_weight_g) : null
                        const isUnder = typeof diffVal === 'number' && diffVal < 0
                        // Highlight only the single most negative diff entry for this plant
                        const isMostNegative = isUnder && (it === mostNegativeEntry || (
                          // Fallback equality by key fields if object identity differs
                          mostNegativeEntry && it?.measured_at === mostNegativeEntry?.measured_at &&
                          it?.last_wet_weight_g === mostNegativeEntry?.last_wet_weight_g &&
                          it?.target_weight_g === mostNegativeEntry?.target_weight_g
                        ))
                        const trStyle = isMostNegative
                          ? { backgroundColor: 'var(--warn-row-bg, rgba(255, 165, 0, 0.10))' }
                          : undefined
                        return (
                          <tr key={idx} style={trStyle} title={isMostNegative ? `Most under target by ${Math.abs(diffVal)}g` : undefined}>
                            <td>{it.measured_at || '—'}</td>
                            <td style={{ textAlign: 'right' }}>{it.water_added_g ?? '—'}</td>
                            <td style={{ textAlign: 'right' }}>{it.last_wet_weight_g ?? '—'}</td>
                            <td style={{ textAlign: 'right' }}>{
                              hasNums
                                ? (() => {
                                    const diff = diffVal
                                    return diff > 0 ? `+${diff}` : `${diff}`
                                  })()
                                : '—'
                            }</td>
                            <td style={{ textAlign: 'right', color: 'var(--danger-fg)' }}>{it.under_g ?? '—'}</td>
                            <td style={{ textAlign: 'right', color: 'var(--danger-fg)' }}>{
                              typeof it.under_pct === 'number' ? Math.round(it.under_pct) : '—'
                            }</td>
                          </tr>
                        )
                      })}
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
