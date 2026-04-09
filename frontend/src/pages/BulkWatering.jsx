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
import usePlants from '../hooks/usePlants.js'

export default function BulkWatering() {
  // Use shared usePlants hook for consistent data fetching
  const { plants, loading, error } = usePlants()

  const navigate = useNavigate()
  const [inputStatus, setInputStatus] = useState({})
  const [measurementIds, setMeasurementIds] = useState({})
  const [originalWaterLoss, setOriginalWaterLoss] = useState({})
  // Toggle to switch between only-needs-water vs all plants
  const [showAll, setShowAll] = useState(false)
  // Snapshot of plants that needed watering on initial load
  const [initialNeedsWaterIds, setInitialNeedsWaterIds] = useState([])
  const [approximations, setApproximations] = useState({})
  const operationMode = typeof localStorage !== 'undefined' ? localStorage.getItem('operationMode') : 'manual'

  // Load approximations separately when plants are loaded
  useEffect(() => {
    let cancelled = false
    async function loadApproximations() {
      if (!plants.length || operationMode !== 'vacation') return

      try {
        const approxData = await plantsApi.getApproximation()
        const approxItems = approxData?.items || []
        const approxMap = approxItems.reduce((acc, item) => {
          acc[item.plant_uuid] = item
          return acc
        }, {})

        if (!cancelled) {
          setApproximations(approxMap)
          // Snapshot which plants needed watering at the moment of initial page load
          setInitialNeedsWaterIds(plants.filter(p => checkNeedsWater(p, operationMode, approxMap[p.uuid])).map(p => p.uuid))
        }
      } catch (e) {
        console.error('Failed to load approximations', e)
      }
    }

    loadApproximations()
    return () => { cancelled = true }
  }, [plants, operationMode])

  // For manual mode, set initial needs water IDs when plants load
  useEffect(() => {
    if (operationMode === 'manual' && plants.length && initialNeedsWaterIds.length === 0) {
      setInitialNeedsWaterIds(plants.filter(p => checkNeedsWater(p, operationMode, null)).map(p => p.uuid))
    }
  }, [plants, operationMode, initialNeedsWaterIds.length])

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

    const plant = plants.find(p => p.uuid === plantId)
    if (plant && !measurementIds[plantId]) {
      setOriginalWaterLoss(prev => ({ ...prev, [plantId]: plant.water_loss_total_pct }))
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

  async function handleVacationWateringCommit(plantId) {
    const plant = plants.find(p => p.uuid === plantId)
    if (plant) {
      setOriginalWaterLoss(prev => ({ ...prev, [plantId]: plant.water_loss_total_pct }))
    }
    setInputStatus(prev => ({ ...prev, [plantId]: 'saving' }))
    try {
      const data = await measurementsApi.watering.createVacation({ plant_id: plantId })
      const measurement = data?.data || data
      if (measurement?.id) {
        setMeasurementIds(prev => ({ ...prev, [plantId]: measurement.id }))
        setInputStatus(prev => ({ ...prev, [plantId]: 'success' }))
        
        // Update plant data in list
        setPlants(prev => prev.map(p => {
          if (p.uuid === plantId) {
            return {
              ...p,
              water_loss_total_pct: measurement.water_loss_total_pct ?? p.water_loss_total_pct,
              water_retained_pct: measurement.water_retained_pct ?? p.water_retained_pct,
              latest_at: measurement.latest_at || measurement.measured_at || p.latest_at,
              measured_at: measurement.measured_at || p.measured_at,
            }
          }
          return p
        }))

        // Refresh approximations to update days_offset and next_watering_at
        try {
          const approxData = await plantsApi.getApproximation()
          const approxItems = approxData?.items || []
          const approxMap = approxItems.reduce((acc, item) => {
            acc[item.plant_uuid] = item
            return acc
          }, {})
          setApproximations(approxMap)
        } catch (e) {
          console.error('Failed to refresh approximations', e)
        }
      } else {
        setInputStatus(prev => ({ ...prev, [plantId]: 'error' }))
      }
    } catch (err) {
      console.error('Error saving vacation watering:', err)
      setInputStatus(prev => ({ ...prev, [plantId]: 'error' }))
    }
  }

  async function handleVacationWateringDelete(plantId, measurementId) {
    setInputStatus(prev => ({ ...prev, [plantId]: 'saving' }))
    try {
      await measurementsApi.delete(measurementId)
      setMeasurementIds(prev => {
        const next = { ...prev }
        delete next[plantId]
        return next
      })
      setInputStatus(prev => {
        const next = { ...prev }
        delete next[plantId]
        return next
      })
      
      // Revert plant data in list to previous state (approximate)
      setPlants(prev => prev.map(p => {
        if (p.uuid === plantId) {
          return {
            ...p,
            water_loss_total_pct: originalWaterLoss[plantId] !== undefined ? originalWaterLoss[plantId] : p.water_loss_total_pct,
            water_retained_pct: null,
            latest_at: p.latest_at, // Keep it for now, list will refresh if navigated back
          }
        }
        return p
      }))
      setOriginalWaterLoss(prev => {
        const next = { ...prev }
        delete next[plantId]
        return next
      })

      // Refresh approximations to update days_offset and next_watering_at
      try {
        const approxData = await plantsApi.getApproximation()
        const approxItems = approxData?.items || []
        const approxMap = approxItems.reduce((acc, item) => {
          acc[item.plant_uuid] = item
          return acc
        }, {})
        setApproximations(approxMap)
      } catch (e) {
        console.error('Failed to refresh approximations', e)
      }
    } catch (err) {
      console.error('Error deleting vacation watering:', err)
      setInputStatus(prev => ({ ...prev, [plantId]: 'error' }))
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

      <p>{operationMode === 'vacation' ? 'Click the water drop icon to record watering based on historical data.' : 'Enter the new weight after watering.'} {operationMode === 'vacation' 
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
          onCommitVacationWatering={handleVacationWateringCommit}
          onDeleteVacationWatering={handleVacationWateringDelete}
          measurementIds={measurementIds}
          onViewPlant={handleView}
          firstColumnLabel="Water: Retained %, Next date"
          firstColumnTooltip="Manual/Automatic: Enter weight in grams. Vacation: Record watering icon. Column also shows water retained (%) and next scheduled watering."
          waterLossCellStyle={waterLossCellStyle}
          showUpdatedColumn={true}
          deemphasizePredicate={deemphasizePredicate}
          operationMode={operationMode}
          approximations={approximations}
          noPlantsMessage="No plants need watering"
        />
      )}
    </DashboardLayout>
  )
}
