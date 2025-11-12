import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate } from 'react-router-dom'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'
import { nowLocalISOMinutes } from '../utils/datetime.js'
import BulkMeasurementTable from '../components/BulkMeasurementTable.jsx'
import { waterLossCellStyle } from '../utils/waterLoss.js'

export default function BulkWatering() {
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const [inputStatus, setInputStatus] = useState({})
  const [measurementIds, setMeasurementIds] = useState({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await plantsApi.list()
        const list = Array.isArray(data) ? data : []
        // Show only plants with water_loss_total_pct > 70
        const filtered = list.filter(p => (p.water_loss_total_pct ?? -Infinity) > 70)
        if (!cancelled) setPlants(filtered)
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


  return (
    <DashboardLayout title="Bulk watering">
      <PageHeader
        title="Bulk watering"
        onBack={() => navigate('/daily')}
        titleBack="Daily Care"
      />

      <p>Enter the new weight after watering for plants that need water (loss > 70%).</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div className="text-danger">{error}</div>}

      {!loading && !error && (
        <BulkMeasurementTable
          plants={plants}
          inputStatus={inputStatus}
          onCommitValue={handleWateringCommit}
          onViewPlant={handleView}
          firstColumnLabel="New weight after watering"
          getWaterLossCellStyle={waterLossCellStyle}
        />
      )}
    </DashboardLayout>
  )
}
