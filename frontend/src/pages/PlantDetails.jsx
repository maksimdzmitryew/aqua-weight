import React, { useCallback, useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate, useParams, useLocation as useRouterLocation } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { formatDateTime } from '../utils/datetime.js'
import { useTheme } from '../ThemeContext.jsx'
import QuickCreateButtons from '../components/QuickCreateButtons.jsx'
import IconButton from '../components/IconButton.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'

export default function PlantDetails() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  const routerLocation = useRouterLocation()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [plant, setPlant] = useState(routerLocation.state?.plant || null)
  const [loading, setLoading] = useState(!routerLocation.state?.plant)
  const [error, setError] = useState('')
  const [measurements, setMeasurements] = useState([])
  const [measLoading, setMeasLoading] = useState(false)
  const [measError, setMeasError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toDeleteMeas, setToDeleteMeas] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!uuid) { setError('Missing id'); setLoading(false); return }
      try {
        const res = await fetch(`/api/plants/${uuid}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setPlant(data)
      } catch (e) {
        if (!cancelled) setError('Failed to load plant')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (!plant) load()
    return () => { cancelled = true }
  }, [uuid])

  const fetchMeasurements = useCallback(async () => {
    if (!uuid) return
    setMeasLoading(true)
    setMeasError('')
    try {
      const res = await fetch(`/api/plants/${uuid}/measurements`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMeasurements(Array.isArray(data) ? data : [])
    } catch (e) {
      setMeasError('Failed to load measurements')
    } finally {
      setMeasLoading(false)
    }
  }, [uuid])

  useEffect(() => {
    fetchMeasurements()
  }, [fetchMeasurements])

  const box = {
    background: isDark ? '#0b0f16' : '#ffffff',
    border: isDark ? '1px solid #1f2937' : '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 16,
  }

  // Set browser tab title to "<Plant Name> – AW Frontend" with project name last
  useEffect(() => {
    if (plant?.name) {
      document.title = `${plant.name} – AW Frontend`
    }
  }, [plant?.name])

  function handleEditMeasurement(m) {
    if (!m?.id) return
    if ((m?.measured_weight_g || 0) > 0) {
       navigate(`/measurement/weight?id=${m.id}`)
    } else {
      navigate(`/measurement/watering?id=${m.id}`)
    }
  }

  function handleDeleteMeasurement(m) {
    setToDeleteMeas(m)
    setConfirmOpen(true)
  }

  function closeMeasDialog() {
    setConfirmOpen(false)
    setToDeleteMeas(null)
  }

  async function confirmDeleteMeasurement() {
    if (!toDeleteMeas?.id) { closeMeasDialog(); return }
    try {
      const res = await fetch(`/api/measurements/${toDeleteMeas.id}`, { method: 'DELETE' })
      if (!res.ok) {
        // optional: could show error
      }
    } catch (e) {
      // ignore
    } finally {
      await fetchMeasurements()
      closeMeasDialog()
    }
  }

  return (
    <DashboardLayout title={plant ? plant.name : 'Plant details'}>
      <div>
        <PageHeader
          title={plant ? plant.name : 'Plants details'}
          onBack={() => navigate('/plants')}
          titleBack="Plants"
          isDark={isDark}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {plant?.uuid && (
            <>
              <button type="button" onClick={() => navigate(`/plants/${plant.uuid}/edit`, { state: { plant } })}
                      style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', background: isDark ? '#1f2937' : '#111827', color: 'white' }}>
                Edit
              </button>
              <QuickCreateButtons plantUuid={plant.uuid} plantName={plant.name} />
            </>
          )}
        </div>
      </div>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}

      {plant && !loading && !error && (
        <>
          <div style={box}>
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 10, columnGap: 16 }}>
              <div style={{ fontWeight: 600 }}>Description</div>
              <div>{plant.description || '—'}</div>
              <div style={{ fontWeight: 600 }}>Location</div>
              <div>{plant.location || '—'}</div>
              <div style={{ fontWeight: 600 }}>Created</div>
              <div>{formatDateTime(plant.created_at)}</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Measurements</h3>
            {measLoading && <div>Loading measurements…</div>}
            {measError && !measLoading && <div style={{ color: 'crimson' }}>{measError}</div>}
            {!measLoading && !measError && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>Actions</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>measured_at</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>measured_weight</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>last_dry_weight_g</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>last_wet_weight_g</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_added_g</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_loss_total_pct</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_loss_total_g</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_loss_day_pct</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb', background: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#111827', fontWeight: 600 }}>water_loss_day_g</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measurements.map((m, i) => (
                      <tr key={m.id || i}>
                        <td style={{ padding: '6px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <IconButton icon="edit" label="Edit measurement" onClick={() => handleEditMeasurement(m)} variant="subtle" />
                          <IconButton icon="delete" label="Delete measurement" onClick={() => handleDeleteMeasurement(m)} variant="danger" />
                        </td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{formatDateTime(m.measured_at)}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.measured_weight_g ?? '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.last_dry_weight_g ?? '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.last_wet_weight_g ?? '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_added_g ?? 0}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_loss_total_pct != null ? `${m.water_loss_total_pct.toFixed?.(2) ?? m.water_loss_total_pct}%` : '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_loss_total_g ?? '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_loss_day_pct != null ? `${m.water_loss_day_pct.toFixed?.(2) ?? m.water_loss_day_pct}%` : '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>{m.water_loss_day_g ?? '—'}</td>
                      </tr>
                    ))}
                    {measurements.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ padding: '8px 10px', borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6' }}>No measurements yet</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={toDeleteMeas ? `Delete measurement` : 'Delete'}
        message="This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        icon="danger"
        onConfirm={confirmDeleteMeasurement}
        onCancel={closeMeasDialog}
      />
    </DashboardLayout>
  )
}
