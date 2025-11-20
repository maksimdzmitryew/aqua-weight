
import React, { useEffect, useState } from 'react'
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

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await plantsApi.list()
        if (!cancelled) setPlants(Array.isArray(data) ? data : [])
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
            water_loss_total_pct: data?.water_loss_total_pct ?? p.water_loss_total_pct
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


  function getWaterLossCellStyle(waterLossPct) {
    if (waterLossPct > 100) {
      return { background: '#dc2626', color: 'white' }
    } else if (waterLossPct > 80) {
      return { background: '#fecaca' }
    } else if (waterLossPct > 40) {
      return { background: '#fef3c7' }
    } else if (waterLossPct > 3) {
      return { background: '#bbf7d0' }
    } else if (waterLossPct > -1) {
      return { color: 'green' }
    } else {
      return { color: 'red' }
    }
  }

  return (
    <DashboardLayout title="Bulk weight measurement">
      <PageHeader
        title="Bulk weight measurement"
        onBack={() => navigate('/daily')}
        titleBack="Daily Care"
      />

      <p>Start bulk weight measurement for all plants.</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div className="text-danger">{error}</div>}

      {!loading && !error && (
        <BulkMeasurementTable
          plants={plants}
          inputStatus={inputStatus}
          onCommitValue={handleWeightMeasurement}
          onViewPlant={handleView}
          firstColumnLabel="New weight"
          getWaterLossCellStyle={waterLossCellStyle}
        />
      )}
    </DashboardLayout>
  )
}