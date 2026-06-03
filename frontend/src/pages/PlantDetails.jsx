import React, { useCallback, useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate, useParams, useLocation as useRouterLocation } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
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
  const [duplicateLoading, setDuplicateLoading] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      if (!uuid) {
        setError('Missing uuid')
        setLoading(false)
        return
      }
      setLoading(true)
      setPlant(null)
      try {
        const data = await plantsApi.getByUuid(uuid, controller.signal)
        setPlant(data)
        setLoading(false)
      } catch (e) {
        if (e.status === 404 || (e.status === 400 && e.detail === 'Invalid plant id')) {
          navigate('/404', { replace: true })
          return
        }
        if (controller.signal.aborted) return
        setLoading(false)
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (isAbort) return
        setError(msg || 'Failed to load plant')
      }
    }

    const statePlant = routerLocation.state?.plant
    if (statePlant && statePlant.uuid === uuid) {
      setPlant(statePlant)
      setLoading(false)
    } else if (!plant || plant.uuid !== uuid) {
      load()
    }

    return () => {
      controller.abort()
    }
  }, [uuid, routerLocation.state?.plant])

  const fetchMeasurements = useCallback(async () => {
    if (!uuid) return
    setMeasLoading(true)
    setMeasurements([])
    setMeasError('')
    try {
      const data = await measurementsApi.listByPlant(uuid)
      const all = Array.isArray(data) ? data : []
      // Show all events (both watering and weight measurements)
      setMeasurements(all)
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
    // Repotting events usually have a note or can be identified by both weights being set 
    // without water_added_g being the primary focus, but we'll use a hint or just check fields.
    const isRepotting = m.note?.toLowerCase().includes('repot') || 
                        (m.last_dry_weight_g > 0 && m.last_wet_weight_g > 0 && !m.water_added_g && m.measured_weight_g > 0)

    if (isRepotting) {
      navigate(`/measurement/repotting?id=${m.id}&plant=${uuid}`)
    } else if ((m?.measured_weight_g || 0) > 0) {
      navigate(`/measurement/weight?id=${m.id}&plant=${uuid}`)
    } else {
      navigate(`/measurement/watering?id=${m.id}&plant=${uuid}`)
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
    if (!toDeleteMeas?.id) {
      closeMeasDialog()
      return
    }
    try {
      await measurementsApi.delete(uuid, toDeleteMeas.id)
    } catch (e) {
      setMeasError(e?.message || 'Failed to delete measurement')
    } finally {
      await fetchMeasurements()
      closeMeasDialog()
    }
  }

  async function handleDuplicate() {
    if (!plant?.uuid) return
    setDuplicateLoading(true)
    setDuplicateError('')
    try {
      const res = await plantsApi.duplicate(plant.uuid)
      if (res.uuid) {
        navigate(`/plants/${res.uuid}`)
      }
    } catch (e) {
      setDuplicateError(e?.message || 'Failed to duplicate plant')
    } finally {
      setDuplicateLoading(false)
    }
  }

  const browserTitle = plant
    ? plant.identify_hint
      ? `${plant.identify_hint} ${plant.name}`
      : plant.name
    : 'Plant details'

  return (
    <DashboardLayout title={browserTitle}>
      <div>
        <PageHeader
          title={plant ? plant.name : 'Plants details'}
          subtitle={plant?.identify_hint}
          onBack={() => navigate('/plants')}
          titleBack="Plants"
        />

        <div className="flex items-center gap-2 flex-wrap">
          {plant?.uuid && (
            <>
              <button
                type="button"
                onClick={() => navigate(`/plants/${plant.uuid}/edit`, { state: { plant } })}
                className="btn btn-primary"
              >
                Edit
              </button>

              <button
                type="button"
                onClick={handleDuplicate}
                disabled={duplicateLoading}
                className="btn btn-secondary"
              >
                {duplicateLoading ? 'Duplicating...' : 'Duplicate'}
              </button>
              <QuickCreateButtons plantUuid={plant.uuid} plantName={plant.name} />
            </>
          )}
        </div>
      </div>

      {loading && <Loader label="Loading plant..." />}
      {error && !loading && <ErrorNotice message={error} />}
      {duplicateError && (
        <div className="mt-4">
          <ErrorNotice message={duplicateError} />
        </div>
      )}

      {plant && !loading && !error && (
        <>
          <div className="card">
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              <div className="fw-600">Description</div>
              <div>{plant.description || '—'}</div>
              <div className="fw-600">Location</div>
              <div>{plant.location || '—'}</div>
              <div className="fw-600">Minimum Weight</div>
              <div>{plant.min_dry_weight_g ? `${plant.min_dry_weight_g}g` : '—'}</div>
              <div className="fw-600">Maximum Water</div>
              <div>{plant.max_water_weight_g ? `${plant.max_water_weight_g}g` : '—'}</div>
              <div className="fw-600">Added to collection</div>
              <DateTimeText as="div" value={plant.created_at} />
            </div>
          </div>

          <div className="mt-4">
            <h3 className="mt-0">Measurements</h3>
            {measLoading && <Loader label="Loading measurements..." />}
            {measError && !measLoading && (
              <ErrorNotice message={measError} onRetry={fetchMeasurements} />
            )}
            {!measLoading &&
              !measError &&
              (measurements.length === 0 ? (
                <EmptyState
                  title="No measurements yet"
                  description="Record a measurement to see history here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="th right">Actions</th>
                        <th className="th">Type</th>
                        <th className="th">measured_at</th>
                        <th className="th">measured_weight</th>
                        <th className="th">last_dry_weight_g</th>
                        <th className="th">last_wet_weight_g</th>
                        <th className="th">water_added_g</th>
                        <th className="th">Note</th>
                        <th className="th">water_loss_total_pct</th>
                        <th className="th">water_loss_total_g</th>
                        <th className="th">water_loss_day_pct</th>
                        <th className="th">water_loss_day_g</th>
                      </tr>
                    </thead>
                    <tbody>
                      {measurements.map((m, i) => {
                        const isRepotting = m.note?.toLowerCase().includes('repot') || 
                                           (m.last_dry_weight_g > 0 && m.last_wet_weight_g > 0 && !m.water_added_g && m.measured_weight_g > 0)
                        const isWatering = !isRepotting && m.water_added_g > 0
                        const isWeight = !isRepotting && !isWatering && m.measured_weight_g > 0

                        let type = 'Measurement'
                        if (isRepotting) type = 'Repotting'
                        else if (isWatering) type = 'Watering'
                        else if (isWeight) type = 'Weight'

                        return (
                          <tr key={m.id || i}>
                            <td className="td text-right nowrap">
                              <IconButton
                                icon="edit"
                                label="Edit"
                                onClick={() => handleEditMeasurement(m)}
                                variant="subtle"
                              />
                              <IconButton
                                icon="delete"
                                label="Delete"
                                onClick={() => handleDeleteMeasurement(m)}
                                variant="danger"
                              />
                            </td>
                            <td className="td">
                              <span className={`badge ${isRepotting ? 'badge-info' : isWatering ? 'badge-success' : ''}`}>
                                {type}
                              </span>
                            </td>
                            <td className="td">
                              <DateTimeText value={m.measured_at} />
                            </td>
                            <td className="td">{m.measured_weight_g ?? '—'}</td>
                            <td className="td">{m.last_dry_weight_g ?? '—'}</td>
                            <td className="td">{m.last_wet_weight_g ?? '—'}</td>
                            <td className="td">{m.water_added_g ?? 0}</td>
                            <td className="td" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.note}>
                              {m.note || '—'}
                            </td>
                            <td className="td">
                              {m.water_loss_total_pct != null
                                ? `${m.water_loss_total_pct.toFixed?.(2) ?? m.water_loss_total_pct}%`
                                : '—'}
                            </td>
                            <td className="td">{m.water_loss_total_g ?? '—'}</td>
                            <td className="td">
                              {m.water_loss_day_pct != null
                                ? `${m.water_loss_day_pct.toFixed?.(2) ?? m.water_loss_day_pct}%`
                                : '—'}
                            </td>
                            <td className="td">{m.water_loss_day_g ?? '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
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
