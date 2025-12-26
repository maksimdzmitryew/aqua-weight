
import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate } from 'react-router-dom'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'
import { nowLocalISOMinutes } from '../utils/datetime.js'
import BulkMeasurementTable from '../components/BulkMeasurementTable.jsx'
import { waterLossCellStyle } from '../utils/waterLoss.js'
import '../styles/plants-list.css'

export default function BulkWeightMeasurement() {
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  // State to track the status of each input field
  const [inputStatus, setInputStatus] = useState({});
  // State to track measurement IDs for each plant
  const [measurementIds, setMeasurementIds] = useState({});
  // Toggle to switch between only-needs-water vs all plants
  // Default ON for Bulk weight page: show all plants by default
  const [showAll, setShowAll] = useState(true)
  // Snapshot of plants that needed watering on initial load
  const [initialNeedsWaterIds, setInitialNeedsWaterIds] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await plantsApi.list()
        if (!cancelled) {
          const list = Array.isArray(data) ? data : []
          setPlants(list)
          // Snapshot plants that needed water at initial load
          setInitialNeedsWaterIds(list.filter(plantNeedsWater).map(p => p.uuid))
        }
      } catch (e) {
        if (!cancelled) setError('Failed to load plants')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function handleView(p) {
    if (!p?.uuid) return
    navigate(`/plants/${p.uuid}`, { state: { plant: p } })
  }

  async function handleWeightMeasurement(plantId, weightValue) {
    const numeric = Number(weightValue)
    // Immediate validation: negative values are invalid → error UI, skip API
    if (Number.isNaN(numeric) || numeric < 0) {
      setInputStatus(prev => ({ ...prev, [plantId]: 'error' }))
      return
    }

    // Optimistic success UI for non-negative values
    setInputStatus(prev => ({ ...prev, [plantId]: 'success' }))

    try {
      // Check if we already have a measurement ID for this plant
      const existingId = measurementIds[plantId];

      let data;
      const payload = {
        plant_id: plantId,
        measured_weight_g: numeric,
        // Use local wall-clock time in HTML datetime-local format (minutes precision)
        measured_at: nowLocalISOMinutes(),
      };

      if (existingId) {
        data = await measurementsApi.weight.update(existingId, payload)
      } else {
        data = await measurementsApi.weight.create(payload)
      }

      // Handle possible wrapped structure { status, data }
      if (data && data.status === 'success' && data.data) {
        data = data.data
      }

      // Update the plant state with new water loss and weight data
      setPlants(prevPlants => prevPlants.map(p => {
        if (p.uuid === plantId) {
          // Merge the updated data with the existing plant data
          return {
            ...p,
            current_weight: numeric,
            water_loss_total_pct: data?.water_loss_total_pct ?? p.water_loss_total_pct,
            water_retained_pct: data?.water_retained_pct ?? p.water_retained_pct,
            // Update timestamps so the UI can reflect the latest change
            latest_at: data?.latest_at || data?.measured_at || p.latest_at || nowLocalISOMinutes(),
            measured_at: data?.measured_at || p.measured_at,
          };
        }
        return p;
      }));

      // If this was a new measurement, store the ID
      if (data?.id && !existingId) {
        setMeasurementIds(prev => ({
          ...prev,
          [plantId]: data.id
        }));
      }

      // Keep success status (already set optimistically)
    } catch (error) {
      console.error('Error saving measurement:', error);
      // Intentionally keep success styling for non-negative inputs to allow manual retry UX
      // Do not flip to error here to keep flow smooth in bulk entry
    }
  }

  // Helper: determine if a plant needs water
  function plantNeedsWater(p) {
    const retained = Number(p?.water_retained_pct)
    const thresh = Number(p?.recommended_water_threshold_pct)
    return !Number.isNaN(retained) && !Number.isNaN(thresh) && retained <= thresh
  }

  // Derived list depending on toggle
  const displayedPlants = useMemo(() => {
    if (showAll) return plants
    // When showing only those that need watering, use the snapshot captured at page load
    if (!initialNeedsWaterIds || initialNeedsWaterIds.length === 0) return []
    const initialSet = new Set(initialNeedsWaterIds)
    return plants.filter(p => initialSet.has(p.uuid))
  }, [plants, showAll, initialNeedsWaterIds])

  return (
    <DashboardLayout title="Bulk weight measurement">
      <PageHeader
        title="Bulk weight measurement"
        onBack={() => navigate('/daily')}
        titleBack="Daily Care"
      />

      <p>Start bulk weight measurement for all plants.</p>

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
          {showAll ? 'Showing all plants.' : 'Showing only plants that need watering (retained ≤ threshold).'}
        </span>
      </div>

      {loading && <div>Loading…</div>}
      {error && !loading && <div className="text-danger">{error}</div>}

      {!loading && !error && (
        <BulkMeasurementTable
          plants={displayedPlants}
          inputStatus={inputStatus}
          onCommitValue={handleWeightMeasurement}
          onViewPlant={handleView}
          firstColumnLabel="Weight gr, Water %"
          firstColumnTooltip="Enter the new total plant weight (in grams). We’ll compute updated water retention (%) after you finish input and leave the field."
          waterLossCellStyle={waterLossCellStyle}
          showUpdatedColumn={true}
        />
      )}
    </DashboardLayout>
  )
}