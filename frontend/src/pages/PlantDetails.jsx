import React, { useCallback, useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate, useParams, useLocation as useRouterLocation } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { formatDateTime } from '../utils/datetime.js'
import QuickCreateButtons from '../components/QuickCreateButtons.jsx'
import IconButton from '../components/IconButton.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import EmptyState from '../components/feedback/EmptyState.jsx'

export default function PlantDetails() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  const routerLocation = useRouterLocation()

  const [plant, setPlant] = useState(routerLocation.state?.plant || null)
  const [loading, setLoading] = useState(!routerLocation.state?.plant)
  const [error, setError] = useState('')
  const [measurements, setMeasurements] = useState([])
  const [measLoading, setMeasLoading] = useState(false)
  const [measError, setMeasError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toDeleteMeas, setToDeleteMeas] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      if (!uuid) { setError('Missing uuid'); setLoading(false); return }
      try {
        const data = await plantsApi.getByUuid(uuid, controller.signal)
        setPlant(data)
      } catch (e) {
        // Ignore abort errors (e.g., React StrictMode double-invokes effects in dev)
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (!isAbort) setError(msg || 'Failed to load plant')
      } finally {
        setLoading(false)
      }
    }
    if (!plant) load()
    return () => { controller.abort() }
  }, [uuid])

  const fetchMeasurements = useCallback(async () => {
    if (!uuid) return
    setMeasLoading(true)
    setMeasError('')
    try {
      const data = await measurementsApi.listByPlant(uuid)
      setMeasurements(Array.isArray(data) ? data : [])
    } catch (e) {
      setMeasError(e?.message || 'Failed to load measurements')
    } finally {
      setMeasLoading(false)
    }
  }, [uuid])

  useEffect(() => {
    fetchMeasurements()
  }, [fetchMeasurements])


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
      await measurementsApi.delete(toDeleteMeas.id)
    } catch (e) {
      // ignore optional error display
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
        />

        <div className="flex items-center gap-2 flex-wrap">
          {plant?.uuid && (
            <>
              <button type="button" onClick={() => navigate(`/plants/${plant.uuid}/edit`, { state: { plant } })}
                      className="btn btn-primary">
                Edit
              </button>
              <QuickCreateButtons plantUuid={plant.uuid} plantName={plant.name} />
            </>
          )}
        </div>
      </div>

      {loading && <Loader label="Loading plant…" />}
      {error && !loading && <ErrorNotice message={error} />}

      {plant && !loading && !error && (
        <>
          <div className="card">
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              <div className="fw-600">Description</div>
              <div>{plant.description || '—'}</div>
              <div className="fw-600">Location</div>
              <div>{plant.location || '—'}</div>
              <div className="fw-600">Created</div>
              <div>{formatDateTime(plant.created_at)}</div>
            </div>
          </div>

          <div className="mt-4">
            <h3 className="mt-0">Measurements</h3>
            {measLoading && <Loader label="Loading measurements…" />}
            {measError && !measLoading && <ErrorNotice message={measError} onRetry={fetchMeasurements} />}
            {!measLoading && !measError && (
              measurements.length === 0 ? (
                <EmptyState title="No measurements yet" description="Record a watering or weight measurement to see history here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="th right">Actions</th>
                        <th className="th">measured_at</th>
                        <th className="th">measured_weight</th>
                        <th className="th">last_dry_weight_g</th>
                        <th className="th">last_wet_weight_g</th>
                        <th className="th">water_added_g</th>
                        <th className="th">water_loss_total_pct</th>
                        <th className="th">water_loss_total_g</th>
                        <th className="th">water_loss_day_pct</th>
                        <th className="th">water_loss_day_g</th>
                      </tr>
                    </thead>
                    <tbody>
                      {measurements.map((m, i) => (
                        <tr key={m.id || i}>
                          <td className="td text-right nowrap">
                            <IconButton icon="edit" label="Edit measurement" onClick={() => handleEditMeasurement(m)} variant="subtle" />
                            <IconButton icon="delete" label="Delete measurement" onClick={() => handleDeleteMeasurement(m)} variant="danger" />
                          </td>
                          <td className="td">{formatDateTime(m.measured_at)}</td>
                          <td className="td">{m.measured_weight_g ?? '—'}</td>
                          <td className="td">{m.last_dry_weight_g ?? '—'}</td>
                          <td className="td">{m.last_wet_weight_g ?? '—'}</td>
                          <td className="td">{m.water_added_g ?? 0}</td>
                          <td className="td">{m.water_loss_total_pct != null ? `${m.water_loss_total_pct.toFixed?.(2) ?? m.water_loss_total_pct}%` : '—'}</td>
                          <td className="td">{m.water_loss_total_g ?? '—'}</td>
                          <td className="td">{m.water_loss_day_pct != null ? `${m.water_loss_day_pct.toFixed?.(2) ?? m.water_loss_day_pct}%` : '—'}</td>
                          <td className="td">{m.water_loss_day_g ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
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
