import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'
import Sparkline from '../components/Sparkline.jsx'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../ThemeContext.jsx'

export function getInitialShowSuggestedInterval(getItem) {
  try {
    const v = getItem?.('chart.showSuggestedInterval')
    if (v === '0') return false
    return true // default: enabled
  } catch { return true }
}

// Extracted tiny helpers to aid coverage tooling and keep UI code clean
export function isAbortError(e) {
  const msg = e?.message || ''
  return e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
}

export function arrayOrEmpty(data) {
  return Array.isArray(data) ? data : []
}

// Safely read from localStorage; returns null when unavailable or on error
export function safeLocalGetItem(key) {
  try {
    // eslint-disable-next-line no-undef
    return (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

export function getInitialChartsPerRow(getItem) {
  const raw = typeof getItem === 'function' ? getItem('dashboard.chartsPerRow') : null
  const n = parseInt(raw, 10)
  if (Number.isFinite(n) && n >= 1 && n <= 5) return n
  return 2
}

export function clampChartsPerRow(value) {
  const v = parseInt(value, 10)
  return Math.max(1, Math.min(5, Number.isFinite(v) ? v : 2))
}

// Compute timestamp from measurement; NaN when absent/invalid
export function toTimestamp(m) {
  const s = m?.measured_at
  if (!s) return NaN
  return Date.parse(String(s).replace(' ', 'T'))
}

// Safely persist to localStorage; ignore errors
export function safeSetItem(key, value) {
  try {
    // eslint-disable-next-line no-undef
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {}
}

export default function Dashboard() {
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Map from plant uuid -> array of measurements (already filtered since last repotting)
  const [series, setSeries] = useState({})
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [seriesError, setSeriesError] = useState('')
  // Reference line toggles (restored)
  const [showMinRef, setShowMinRef] = useState(true)
  const [showMaxRef, setShowMaxRef] = useState(true)
  const [showThreshRef, setShowThreshRef] = useState(true)
  // Suggested watering interval (first-below-threshold blue marker)
  const [showSuggestedInterval, setShowSuggestedInterval] = useState(() => (
    getInitialShowSuggestedInterval((key) => safeLocalGetItem(key))
  ))
  const [chartsPerRow, setChartsPerRow] = useState(() => {
    return getInitialChartsPerRow(safeLocalGetItem)
  })
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()

  useEffect(() => {
    const controller = new AbortController()
    async function loadPlants() {
      try {
        const data = await plantsApi.list(controller.signal)
        setPlants(arrayOrEmpty(data))
      } catch (e) {
        const msg = e?.message || ''
        if (!isAbortError(e)) setError(msg || 'Failed to load plants')
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
              const arr = arrayOrEmpty(data)
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
                const t = toTimestamp(m)
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
          <span>Show min dry weight</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={showMaxRef} onChange={(e) => setShowMaxRef(e.target.checked)} />
          <span>Show max water weight</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={showThreshRef} onChange={(e) => setShowThreshRef(e.target.checked)} />
          <span>Recommended threshold</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={showSuggestedInterval}
            onChange={(e) => {
              const val = e.target.checked
              setShowSuggestedInterval(val)
              safeSetItem('chart.showSuggestedInterval', val ? '1' : '0')
            }}
          />
          <span>Show suggested watering interval</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          <span>Charts per row</span>
          <select
            value={chartsPerRow}
            onChange={(e) => {
              const clamped = clampChartsPerRow(e.target.value)
              setChartsPerRow(clamped)
              safeSetItem('dashboard.chartsPerRow', String(clamped))
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
          {plants.map((p, idx) => {
            const plantKey = p?.uuid || `idx-${idx}`
            const pts = series[p?.uuid] || []
            const cardBg = effectiveTheme === 'dark' ? '#111827' : 'white'
            const cardBorder = effectiveTheme === 'dark' ? '#374151' : '#e5e7eb'
            // Build reference lines per plant
            const refLines = []
            const minDry = Number.isFinite(p?.min_dry_weight_g) ? Number(p.min_dry_weight_g) : null
            const maxWater = Number.isFinite(p?.max_water_weight_g) ? Number(p.max_water_weight_g) : null
            const threshPct = Number.isFinite(p?.recommended_water_threshold_pct) ? Number(p.recommended_water_threshold_pct) : null
            if (showMinRef && minDry != null) refLines.push({ y: minDry, label: 'Dry' })
            if (showMaxRef && minDry != null && maxWater != null) refLines.push({ y: minDry + maxWater, label: 'Max' })
            // Recommended threshold: min_dry_weight_g + max_water_weight_g * (recommended_pct / 100)
            // Clamp recommended percentage to [0, 100] to keep the line between Dry and Max.
            if (showThreshRef && minDry != null && maxWater != null && threshPct != null) {
              const pct = Number(threshPct)
              if (Number.isFinite(pct)) {
                const frac = Math.max(0, Math.min(1, pct / 100))
                const y = minDry + (maxWater * frac)
                if (Number.isFinite(y)) refLines.push({ y, label: 'Thresh' })
              }
            }
            return (
              <div
                key={plantKey}
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
                    // Watering hint: draw vertical lines at peaks when increase vs previous
                    // exceeds 20% of max water retained
                    maxWaterG={Number.isFinite(p?.max_water_weight_g) ? Number(p.max_water_weight_g) : null}
                    // Toggle the blue marker that suggests watering interval (first drop below threshold)
                    showFirstBelowThreshVLine={!!showSuggestedInterval}
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
