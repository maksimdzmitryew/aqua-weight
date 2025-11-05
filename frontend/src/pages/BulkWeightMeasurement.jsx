
import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate } from 'react-router-dom'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'

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
    try {
      // Check if we already have a measurement ID for this plant
      const existingId = measurementIds[plantId];

      let data;
      const payload = {
        plant_id: plantId,
        measured_weight_g: Number(weightValue),
        measured_at: new Date().toISOString().replace('Z', ''),
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
            current_weight: weightValue,
            water_loss_total_pct: data.water_loss_total_pct
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

      // Set success status for this input
      setInputStatus(prev => ({
        ...prev,
        [plantId]: 'success'
      }));

    } catch (error) {
      console.error('Error saving measurement:', error);

      // Set error status for this input
      setInputStatus(prev => ({
        ...prev,
        [plantId]: 'error'
      }));
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
        <div className="overflow-x-auto">
          <table className="table">
                <thead>
                  <tr>
                    <th className="th">New weight</th>
                    <th className="th">Water loss</th>
                    <th className="th">Name</th>
                    <th className="th">Description</th>
                    <th className="th">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {plants.map((p) => (
                    <tr key={p.id}>
                        <td className="td">
                          <input
                            type="number"
                            className={`input ${inputStatus[p.uuid] === 'success' ? 'bg-success' : ''} ${inputStatus[p.uuid] === 'error' ? 'bg-error' : ''}`}
                            defaultValue={p.current_weight || ''}
                            onBlur={(e) => {
                              if (e.target.value && p.uuid) {
                                handleWeightMeasurement(p.uuid, e.target.value);
                              }
                            }}
                            onChange={(e) => {
                              const input = e.target;
                              input.value = e.target.value;
                            }}
                          />
                        </td>
                      <td className="td" style={getWaterLossCellStyle(p.water_loss_total_pct)} title={p.uuid ? 'View plant' : undefined}>
                        {p.uuid ? (
                          <a
                            href={`/plants/${p.uuid}`}
                            onClick={(e) => { e.preventDefault(); handleView(p) }}
                            className="block-link"
                          >
                            {p.water_loss_total_pct}%
                          </a>
                        ) : (
                          p.water_loss_total_pct
                        )}
                      </td>
                      <td className="td" title={p.uuid ? 'View plant' : undefined}>
                        {p.uuid ? (
                          <a
                            href={`/plants/${p.uuid}`}
                            onClick={(e) => { e.preventDefault(); handleView(p) }}
                            className="block-link"
                          >
                            {p.name}
                          </a>
                        ) : (
                          p.name
                        )}
                      </td>
                      <td className="td" title={p.uuid ? 'View plant' : undefined}>
                        {p.uuid ? (
                          <a
                            href={`/plants/${p.uuid}`}
                            onClick={(e) => { e.preventDefault(); handleView(p) }}
                            className="block-link"
                          >
                            {p.description || '—'}
                          </a>
                        ) : (
                          p.description || '—'
                        )}
                      </td>
                      <td className="td">{p.location || '—'}</td>
                    </tr>
                  ))}
                  {plants.length === 0 && (
                    <tr>
                      <td className="td" colSpan={5}>No plants found</td>
                    </tr>
                  )}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  )
}