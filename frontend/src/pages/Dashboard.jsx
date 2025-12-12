import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'
import Sparkline from '../components/Sparkline.jsx'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../ThemeContext.jsx'

export default function Dashboard() {
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Map from plant uuid -> array of measurements (already filtered since last repotting)
  const [series, setSeries] = useState({})
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [seriesError, setSeriesError] = useState('')
  const [showMinRef, setShowMinRef] = useState(true)
  const [showMaxRef, setShowMaxRef] = useState(true)
  const [showThreshRef, setShowThreshRef] = useState(true)
  const [chartsPerRow, setChartsPerRow] = useState(() => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('dashboard.chartsPerRow') : null
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 1 && n <= 5) return n
    return 2
  })
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()

  useEffect(() => {
    const controller = new AbortController()
    async function loadPlants() {
      try {
        const data = await plantsApi.list(controller.signal)
        setPlants(Array.isArray(data) ? data : [])
      } catch (e) {
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (!isAbort) setError(msg || 'Failed to load plants')
      } finally {
        setLoading(false)
      }
    }
    loadPlants()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    async function loadMeasurements() {
      if (!plants?.length) { setSeries({}); return }
      setSeriesLoading(true)
      setSeriesError('')
      try {
        const entries = await Promise.all(
          plants.map(async (p) => {
            const uid = p?.uuid
            if (!uid) return [null, []]
            try {
              const data = await measurementsApi.listByPlant(uid)
              const arr = Array.isArray(data) ? data : []
              // Find last repotting event based on backend definition:
              // measured_weight_g, last_dry_weight_g, water_added_g are numbers
              // last_wet_weight_g, water_loss_* are null
              let lastRepotIndex = -1
              for (let i = 0; i < arr.length; i++) {
                const m = arr[i]
                const isRepot = (m?.measured_weight_g != null)
                  && (m?.last_dry_weight_g != null)
                  && (m?.water_added_g != null)
                  && (m?.last_wet_weight_g == null)
                  && (m?.water_loss_total_pct == null)
                  && (m?.water_loss_total_g == null)
                  && (m?.water_loss_day_pct == null)
                  && (m?.water_loss_day_g == null)
                if (isRepot) { lastRepotIndex = i; break }
              }
              // Start with measurements strictly after last repotting marker (arr is DESC)
              const afterRepotDesc = (lastRepotIndex >= 0 ? arr.slice(0, lastRepotIndex) : arr)
              // Keep only entries that have measured_weight_g
              const onlyWeightsDesc = afterRepotDesc.filter(m => m?.measured_weight_g != null)
              // Collapse to last reading per day: because array is DESC, the first occurrence per day is the last reading of that day
              const seenDays = new Set()
              const perDayDesc = []
              for (const m of onlyWeightsDesc) {
                const dayKey = m?.measured_at ? m.measured_at.substring(0, 10) : '' // YYYY-MM-DD
                if (!dayKey || seenDays.has(dayKey)) continue
                seenDays.add(dayKey)
                perDayDesc.push(m)
              }
              // Reverse to chronological for charting
              const chronological = perDayDesc.slice().reverse()
              const points = chronological.map((m) => {
                const w = m.measured_weight_g
                const t = m?.measured_at ? Date.parse(m.measured_at.replace(' ', 'T')) : NaN
                if (!isFinite(w) || !isFinite(t)) return null
                const title = `${m.measured_at} — ${w} g`
                return { x: t, y: w, title }
              }).filter(Boolean)
              return [uid, points]
            } catch (e) {
              return [uid, []]
            }
          })
        )
        const map = {}
        for (const [uid, pts] of entries) { if (uid) map[uid] = pts }
        setSeries(map)
      } catch (e) {
        setSeriesError(e?.message || 'Failed to load measurements')
      } finally {
        setSeriesLoading(false)
      }
    }
    loadMeasurements()
  }, [plants])

  const hasPlants = plants && plants.length > 0
  // When showing a single chart per row, give it more vertical space for readability
  const chartHeight = chartsPerRow === 1 ? 180 : 90

  return (
    <DashboardLayout title="Dashboard">
      <h1 style={{ marginTop: 0 }}>Overview</h1>
      <p>Each plant is represented by its weight trend since the last repotting. Daily compression shows only the last reading per day.</p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '8px 0 16px', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={showMinRef} onChange={(e) => setShowMinRef(e.target.checked)} />
          <span>Dry out completely</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={showMaxRef} onChange={(e) => setShowMaxRef(e.target.checked)} />
          <span>Max water</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={showThreshRef} onChange={(e) => setShowThreshRef(e.target.checked)} />
          <span>Min water</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          <span>Charts per row</span>
          <select
            value={chartsPerRow}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              const clamped = Math.max(1, Math.min(5, Number.isFinite(v) ? v : 2))
              setChartsPerRow(clamped)
              try { localStorage.setItem('dashboard.chartsPerRow', String(clamped)) } catch {}
            }}
            style={{ padding: '4px 6px', borderRadius: 6 }}
          >
            {[1,2,3,4,5].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      {loading && <Loader text="Loading plants..." />}
      {error && <ErrorNotice message={error} />}

      {!loading && !error && !hasPlants && (
        <div>No plants yet. Create a plant to see its chart here.</div>
      )}

      {!loading && !error && hasPlants && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${chartsPerRow}, minmax(0, 1fr))`, gap: 16 }}>
          {plants.map((p) => {
            const pts = series[p?.uuid] || []
            const refLines = []
            if (showMinRef && isFinite(p?.min_dry_weight_g)) refLines.push({ y: p.min_dry_weight_g, label: 'Dry' })
            if (showMaxRef && isFinite(p?.min_dry_weight_g) && isFinite(p?.max_water_weight_g)) {
              const maxLine = Number(p.min_dry_weight_g) + Number(p.max_water_weight_g)
              if (isFinite(maxLine)) refLines.push({ y: maxLine, label: 'Max' })
            }
            if (showThreshRef && isFinite(p?.min_dry_weight_g) && isFinite(p?.max_water_weight_g) && isFinite(p?.recommended_water_threshold_pct)) {
              // Compute threshold line: min dry + (1 / max water * recommended threshold)
              // Note: If you intend percent-of-capacity, replace with (max_water_weight_g * recommended_water_threshold_pct / 100)
              const denom = Number(p.max_water_weight_g)
              const thrPct = Number(p.recommended_water_threshold_pct)
              const addend = denom !== 0 ? (denom / 100 * thrPct) : NaN
              const thrLine = Number(p.min_dry_weight_g) + addend
              if (isFinite(thrLine)) refLines.push({ y: thrLine, label: 'Min' })
            }
            // Detect pre-watering points near "Dry" where the next reading jumps significantly.
            // Heuristics: consider a jump if y[i+1] - y[i] >= max(150g, 0.08 * max_water_weight_g).
            // Consider a point "near Dry" if |y[i] - min_dry| <= max(100g, 0.05 * max_water_weight_g).
            const vertLines = []
            if (pts.length > 1 && isFinite(p?.min_dry_weight_g) && isFinite(p?.max_water_weight_g)) {
              const minDry = Number(p.min_dry_weight_g)
              const cap = Math.max(0, Number(p.max_water_weight_g))
              const jumpThresh = Math.max(150, 0.08 * cap)
              const nearTol = Math.max(100, 0.05 * cap)
              for (let i = 0; i < pts.length - 1; i++) {
                const cur = pts[i]
                const next = pts[i + 1]
                if (!cur || !next) continue
                const jump = next.y - cur.y
                const nearDry = Math.abs(cur.y - minDry) <= nearTol
                if (nearDry && jump >= jumpThresh) {
                  vertLines.push({ x: cur.x })
                }
              }
            }
            const cardBg = effectiveTheme === 'dark' ? '#111827' : 'white'
            const cardBorder = effectiveTheme === 'dark' ? '#374151' : '#e5e7eb'
            return (
              <div
                key={p.uuid}
                onClick={() => p?.uuid && navigate(`/stats/${p.uuid}`, { state: { plant: p } })}
                style={{ border: `1px solid ${cardBorder}`, borderRadius: 8, padding: 12, background: cardBg, cursor: 'pointer' }}
                title="Open statistics"
              >
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{p.name}</div>
                {seriesLoading && !pts.length ? (
                  <Loader text="Loading..." />
                ) : pts.length > 1 ? (
                  <Sparkline
                    key={`spark-${p.uuid}-${chartsPerRow}`}
                    data={pts}
                    width="100%"
                    height={chartHeight}
                    showPoints={true}
                    refLines={refLines}
                    vertLines={vertLines}
                  />
                ) : (
                  <div style={{ color: '#6b7280', fontSize: 12 }}>Not enough data to chart</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {seriesError && <div style={{ marginTop: 8 }}><ErrorNotice message={seriesError} /></div>}
    </DashboardLayout>
  )
}
