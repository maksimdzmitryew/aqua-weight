import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate } from 'react-router-dom'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'
import { nowLocalISOMinutes } from '../utils/datetime.js'
import BulkMeasurementTable from '../components/BulkMeasurementTable.jsx'
import { waterLossCellStyle } from '../utils/waterLoss.js'
import { checkNeedsWater } from '../utils/watering'

export default function BulkWatering() {
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const [inputStatus, setInputStatus] = useState({})
  const [measurementIds, setMeasurementIds] = useState({})
  // Toggle to switch between only-needs-water vs all plants
  const [showAll, setShowAll] = useState(false)
  // Snapshot of plants that needed watering on initial load
  const [initialNeedsWaterIds, setInitialNeedsWaterIds] = useState([])
  const [approximations, setApproximations] = useState({})
  const operationMode = typeof localStorage !== 'undefined' ? localStorage.getItem('operationMode') : 'manual'

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const plantsData = await plantsApi.list()
        const allPlants = Array.isArray(plantsData) ? plantsData : []
        
        let approxMap = {}
        if (operationMode === 'vacation') {
          try {
            const approxData = await plantsApi.getApproximation()
            const approxItems = approxData?.items || []
            approxMap = approxItems.reduce((acc, item) => {
              acc[item.plant_uuid] = item
              return acc
            }, {})
          } catch (e) {
            console.error('Failed to load approximations', e)
          }
        }

        if (!cancelled) {
          setPlants(allPlants)
          setApproximations(approxMap)
          // Snapshot which plants needed watering at the moment of initial page load
          setInitialNeedsWaterIds(allPlants.filter(p => checkNeedsWater(p, operationMode, approxMap[p.uuid])).map(p => p.uuid))
        }
      } catch (e) {
        if (!cancelled) setError('Failed to load plants')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [operationMode])

  // Helper: determine if a plant needs water based on per-plant threshold
  function plantNeedsWater(p) {
    return checkNeedsWater(p, operationMode, approximations[p.uuid])
  }

  function handleView(p) {
    if (!p?.uuid) return
    navigate(`/plants/${p.uuid}`, { state: { plant: p } })
  }

  async function handleWateringCommit(plantId, newWeightValue) {
    const numeric = Number(newWeightValue)
    if (Number.isNaN(numeric) || numeric < 0) {
      setInputStatus(prev => ({ ...prev, [plantId]: 'error' }))
      return
    }

    setInputStatus(prev => ({ ...prev, [plantId]: 'success' }))

    try {
      const existingId = measurementIds[plantId]

      let data
      const payload = {
        plant_id: plantId,
        // Entered value is the new total weight after watering
        last_wet_weight_g: numeric,
        measured_at: nowLocalISOMinutes(),
      }

      if (existingId) {
        data = await measurementsApi.watering.update(existingId, payload)
      } else {
        data = await measurementsApi.watering.create(payload)
      }

      if (data && data.status === 'success' && data.data) {
        data = data.data
      }

      setPlants(prev => prev.map(p => {
        if (p.uuid === plantId) {
          return {
            ...p,
            current_weight: numeric,
            water_loss_total_pct: data?.water_loss_total_pct ?? p.water_loss_total_pct,
            water_retained_pct: data?.water_retained_pct ?? p.water_retained_pct,
            // Update timestamps so the UI can reflect the latest change
            latest_at: data?.latest_at || data?.measured_at || p.latest_at || nowLocalISOMinutes(),
            measured_at: data?.measured_at || p.measured_at,
          }
        }
        return p
      }))

      if (data?.id && !existingId) {
        setMeasurementIds(prev => ({ ...prev, [plantId]: data.id }))
      }
    } catch (err) {
      console.error('Error saving watering measurement:', err)
      // Keep optimistic success to allow retry UX
    }
  }

  // Derived list depending on toggle
  const displayedPlants = useMemo(() => {
    if (showAll) return plants
    // When showing only those that need watering, use the snapshot captured at page load
    if (!initialNeedsWaterIds || initialNeedsWaterIds.length === 0) return []
    const initialSet = new Set(initialNeedsWaterIds)
    return plants.filter(p => initialSet.has(p.uuid))
  }, [plants, showAll, initialNeedsWaterIds])

  // Deemphasis predicate for rows above threshold (only when showAll is true)
  const deemphasizePredicate = useMemo(() => {
    if (!showAll) return undefined
    return (p) => !plantNeedsWater(p)
  }, [showAll])


  return (
    <DashboardLayout title="Bulk watering">
      <PageHeader
        title="Bulk watering"
        onBack={() => navigate('/daily')}
        titleBack="Daily Care"
      />

      <p>Enter the new weight after watering. {operationMode === 'vacation' 
        ? 'By default, we show only plants that need water according to the approximation schedule.'
        : 'By default, we show only plants that need water (retained ≤ threshold).'}
      </p>

      {/* Toggle to switch visibility mode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          <span>Show all plants</span>
        </label>
        <span style={{ fontSize: 12, color: 'var(--muted-fg, #6b7280)' }}>
          {showAll ? 'Showing all plants; those above threshold are deemphasized.' : (operationMode === 'vacation'
            ? 'Showing only plants that need watering according to the approximation schedule.'
            : 'Showing only plants that need watering (retained ≤ threshold).')}
        </span>
      </div>

      {loading && <div>Loading…</div>}
      {error && !loading && <div className="text-danger">{error}</div>}

      {!loading && !error && (
        <BulkMeasurementTable
          plants={displayedPlants}
          inputStatus={inputStatus}
          onCommitValue={handleWateringCommit}
          onViewPlant={handleView}
          firstColumnLabel="Weight gr, Water date"
          firstColumnTooltip="Enter the new total plant weight (in grams). We’ll compute updated water retention (%) after you finish input and leave the field."
          waterLossCellStyle={waterLossCellStyle}
          showUpdatedColumn={true}
          deemphasizePredicate={deemphasizePredicate}
          operationMode={operationMode}
          approximations={approximations}
        />
      )}
    </DashboardLayout>
  )
}
