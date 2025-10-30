import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../ThemeContext.jsx'
import { formatDateTime } from '../utils/datetime.js'

export default function BulkWeightMeasurement() {
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/plants')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setPlants(data)
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
        const payload = {
          plant_id: plantId,
          measured_weight_g: Number(weightValue),
          measured_at: new Date().toISOString().replace('Z', '') // Remove the 'Z' from the ISO string
        };

        const response = await fetch('/api/measurements/weight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error('Failed to save measurement');
        }

        // Find the plant in the state and update its current_weight
        setPlants(prevPlants => prevPlants.map(p =>
          p.uuid === plantId ? { ...p, current_weight: weightValue } : p
        ));
      } catch (error) {
        console.error('Error saving measurement:', error);
      }
  }

  const th = {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb',
    background: isDark ? '#111827' : '#f9fafb',
    color: isDark ? '#e5e7eb' : '#111827',
    fontWeight: 600,
  }

  const td = {
    padding: '8px 10px',
    borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6',
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
        onBack={() => navigate('/dashboard')}
        isDark={isDark}
      />

      <p>Start bulk weight measurement for all plants.</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}

      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>New weight</th>
                    <th style={th}>Water loss</th>
                    <th style={th}>Name</th>
                    <th style={th}>Description</th>
                    <th style={th}>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {plants.map((p) => (
                    <tr key={p.id}>
                        <td style={td}>
                          <input
                            type="number"
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              border: isDark ? '1px solid #374151' : '1px solid #e5e7eb',
                              borderRadius: '4px',
                              background: isDark ? '#1f2937' : '#ffffff',
                              color: isDark ? '#e5e7eb' : '#111827',
                              boxSizing: 'border-box'
                            }}
                            defaultValue={p.current_weight || ''}
                            onBlur={(e) => {
                              if (e.target.value && p.uuid) {
                                handleWeightMeasurement(p.uuid, e.target.value);
                              }
                            }}
                            onChange={(e) => {
                              // Update the value in the input field immediately
                              const input = e.target;
                              input.value = e.target.value;
                            }}
                          />
                        </td>
                      <td style={{ ...td, ...getWaterLossCellStyle(p.water_loss_total_pct) }} title={p.uuid ? 'View plant' : undefined}>
                        {p.uuid ? (
                          <a
                            href={`/plants/${p.uuid}`}
                            onClick={(e) => { e.preventDefault(); handleView(p) }}
                            style={{ cursor: 'pointer', color: 'inherit', textDecoration: 'none', display: 'block' }}
                          >
                            {p.water_loss_total_pct}%
                          </a>
                        ) : (
                          p.water_loss_total_pct
                        )}
                      </td>
                      <td style={{ ...td }} title={p.uuid ? 'View plant' : undefined}>
                        {p.uuid ? (
                          <a
                            href={`/plants/${p.uuid}`}
                            onClick={(e) => { e.preventDefault(); handleView(p) }}
                            style={{ cursor: 'pointer', color: 'inherit', textDecoration: 'none', display: 'block' }}
                          >
                            {p.name}
                          </a>
                        ) : (
                          p.name
                        )}
                      </td>
                      <td style={td} title={p.uuid ? 'View plant' : undefined}>
                        {p.uuid ? (
                          <a
                            href={`/plants/${p.uuid}`}
                            onClick={(e) => { e.preventDefault(); handleView(p) }}
                            style={{ cursor: 'pointer', color: 'inherit', textDecoration: 'none', display: 'block' }}
                          >
                            {p.description || '—'}
                          </a>
                        ) : (
                          p.description || '—'
                        )}
                      </td>
                      <td style={td}>{p.location || '—'}</td>
                    </tr>
                  ))}
                  {plants.length === 0 && (
                    <tr>
                      <td style={td} colSpan={5}>No plants found</td>
                    </tr>
                  )}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  )
}