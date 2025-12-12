import React, { useEffect, useState } from 'react'
import { useParams, useLocation as useRouterLocation, useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import Sparkline from '../components/Sparkline.jsx'

export default function PlantStats() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  const routerLocation = useRouterLocation()

  const [plant, setPlant] = useState(routerLocation.state?.plant || null)
  const [loading, setLoading] = useState(!routerLocation.state?.plant)
  const [error, setError] = useState('')

  const [points, setPoints] = useState([])
  const [mLoading, setMLoading] = useState(false)
  const [mError, setMError] = useState('')
  // Respect Dashboard preference for showing suggested watering interval (blue marker)
  const [showSuggestedInterval, setShowSuggestedInterval] = useState(() => {
    try {
      const v = localStorage.getItem('chart.showSuggestedInterval')
      if (v === '0') return false
      return true
    } catch { return true }
  })

  useEffect(() => {
    const controller = new AbortController()
    async function loadPlant() {
      try {
        const data = await plantsApi.getByUuid(uuid, controller.signal)
        setPlant(data)
      } catch (e) {
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (!isAbort) setError(msg || 'Failed to load plant')
      } finally {
        setLoading(false)
      }
    }
    if (!plant && uuid) loadPlant()
    return () => controller.abort()
  }, [uuid])

  useEffect(() => {
    async function loadMeasurements() {
      if (!uuid) return
      setMLoading(true)
      setMError('')
      try {
        const data = await measurementsApi.listByPlant(uuid)
        const arr = Array.isArray(data) ? data : []
        // detect last repot (same signature as Dashboard)
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
        const afterRepotDesc = (lastRepotIndex >= 0 ? arr.slice(0, lastRepotIndex) : arr)
        const onlyWeightsDesc = afterRepotDesc.filter(m => m?.measured_weight_g != null)
        // Collapse to last reading per day
        const seenDays = new Set()
        const perDayDesc = []
        for (const m of onlyWeightsDesc) {
          const dayKey = m?.measured_at ? m.measured_at.substring(0, 10) : ''
          if (!dayKey || seenDays.has(dayKey)) continue
          seenDays.add(dayKey)
          perDayDesc.push(m)
        }
        const chronological = perDayDesc.slice().reverse()
        const pts = chronological.map(m => {
          const w = m.measured_weight_g
          const t = m?.measured_at ? Date.parse(m.measured_at.replace(' ', 'T')) : NaN
          if (!isFinite(w) || !isFinite(t)) return null
          const title = `${m.measured_at} — ${w} g`
          return { x: t, y: w, title }
        }).filter(Boolean)
        setPoints(pts)
      } catch (e) {
        setMError(e?.message || 'Failed to load measurements')
      } finally {
        setMLoading(false)
      }
    }
    loadMeasurements()
  }, [uuid])

  return (
    <DashboardLayout title={plant ? `${plant.name} — Stats` : 'Stats'}>
      <PageHeader title={plant ? plant.name : 'Stats'} onBack={() => navigate('/dashboard')} titleBack="Dashboard" />

      {loading && <Loader text="Loading plant..." />}
      {error && <ErrorNotice message={error} />}

      {!loading && !error && (
        <div>
          <div style={{ marginBottom: 8, color: '#6b7280' }}>Weight since last repotting (last reading per day)</div>
          {mLoading ? (
            <Loader text="Loading measurements..." />
          ) : points.length > 1 ? (
            <div style={{ maxWidth: 960 }}>
              {(() => {
                // Build reference lines to match Dashboard logic so features depending on
                // the recommended threshold ("Thresh") work here as well.
                const refLines = []
                const minDry = Number.isFinite(plant?.min_dry_weight_g) ? Number(plant.min_dry_weight_g) : null
                const maxWater = Number.isFinite(plant?.max_water_weight_g) ? Number(plant.max_water_weight_g) : null
                const threshPct = Number.isFinite(plant?.recommended_water_threshold_pct) ? Number(plant.recommended_water_threshold_pct) : null
                if (minDry != null) refLines.push({ y: minDry, label: 'Dry' })
                if (minDry != null && maxWater != null) refLines.push({ y: minDry + maxWater, label: 'Max' })
                if (minDry != null && maxWater != null && threshPct != null) {
                  const pct = Number(threshPct)
                  if (Number.isFinite(pct)) {
                    const frac = Math.max(0, Math.min(1, pct / 100))
                    const y = minDry + (maxWater * frac)
                    if (Number.isFinite(y)) refLines.push({ y, label: 'Thresh' })
                  }
                }
                return (
                  <Sparkline
                    data={points}
                    width="100%"
                    height={200}
                    showPoints={true}
                    maxWaterG={Number.isFinite(plant?.max_water_weight_g) ? Number(plant.max_water_weight_g) : null}
                    refLines={refLines}
                    // Toggle the blue marker that suggests watering interval (first drop below threshold)
                    showFirstBelowThreshVLine={!!showSuggestedInterval}
                  />
                )
              })()}
            </div>
          ) : (
            <div style={{ color: '#6b7280' }}>Not enough data to chart</div>
          )}

          {mError && <div style={{ marginTop: 8 }}><ErrorNotice message={mError} /></div>}
        </div>
      )}
    </DashboardLayout>
  )
}
