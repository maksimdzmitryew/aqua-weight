import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { measurementsApi } from '../api/measurements'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import useWateringTime from '../hooks/useWateringTime.js'
import WateringTimeBar from '../components/WateringTimeBar.jsx'
import BulkMeasurementTable from '../components/BulkMeasurementTable.jsx'
import { waterLossCellStyle } from '../utils/waterLoss.js'
import Pagination from '../components/Pagination.jsx'
import { apiClient } from '../api/client'
import EmptyState from '../components/feedback/EmptyState.jsx'
import '../styles/plants-list.css'

const TAB_TODO = 'todo'
const TAB_DONE = 'done'
const TAB_ALL = 'all'

export default function BulkWeightMeasurement() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || TAB_TODO
  const pageTodo = parseInt(searchParams.get('page_todo') || '1', 10)
  const pageDone = parseInt(searchParams.get('page_done') || '1', 10)
  const pageAll = parseInt(searchParams.get('page_all') || '1', 10)

  let currentPage = pageTodo
  if (activeTab === TAB_DONE) currentPage = pageDone
  if (activeTab === TAB_ALL) currentPage = pageAll

  const limit = parseInt(
    searchParams.get('limit') ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('pageSize') : null) ||
      '20',
    10,
  )

  const operationMode =
    (typeof localStorage !== 'undefined' ? localStorage.getItem('operationMode') : null) || 'manual'
  const defaultThreshold =
    (typeof localStorage !== 'undefined' ? localStorage.getItem('defaultThreshold') : null) || '40'

  const navigate = useNavigate()
  const wateringTime = useWateringTime()

  // Snapshots of UUIDs for stable tabs
  const [todoUuids, setTodoUuids] = useState(null)
  const [doneUuids, setDoneUuids] = useState(null)
  const [allUuids, setAllUuids] = useState(null)
  const [wateringUuids, setWateringUuids] = useState(null)
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [validationError, setValidationError] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [approximations, setApproximations] = useState({})

  // Session progress buffer (persists across tab switches)
  const [progressBuffer, setProgressBuffer] = useState({})
  const [inputStatus, setInputStatus] = useState({})
  const [measurementIds, setMeasurementIds] = useState({})
  const pendingRequests = React.useRef({})
  const abortControllers = React.useRef({})

  const commonParams = `operationMode=${operationMode}&defaultThreshold=${defaultThreshold}`

  // 1. Initial Load: Fetch stable UUID lists for both tabs and approximations
  useEffect(() => {
    async function init() {
      try {
        setLoading(true)
        const promises = [apiClient.get(`/plants/uuids?needs_watering=true&${commonParams}`)]
        if (operationMode !== 'vacation') {
          promises.push(apiClient.get(`/plants/uuids?needs_weighing=true&${commonParams}`))
          promises.push(apiClient.get(`/plants/uuids?needs_weighing=false&${commonParams}`))
          promises.push(apiClient.get(`/plants/uuids?${commonParams}`))
          promises.push(apiClient.get('/plants/measurements/approximation/watering'))
        }

        const [watering, todo, done, all, approxData] = await Promise.all(promises)
        setWateringUuids(watering || [])
        setError(null)
        if (operationMode !== 'vacation') {
          setTodoUuids(todo || [])
          setDoneUuids(done || [])
          setAllUuids(all || [])

          const approxItems = approxData?.items || []
          const approxMap = approxItems.reduce((acc, item) => {
            acc[item.plant_uuid] = item
            return acc
          }, {})
          setApproximations(approxMap)
        }
      } catch (err) {
        setError('Failed to initialize plant lists')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [operationMode, commonParams])

  // 2. Data Fetching: Load full objects for the current page of UUIDs
  useEffect(() => {
    if (operationMode === 'vacation') return
    let currentUuidList = todoUuids
    if (activeTab === TAB_DONE) currentUuidList = doneUuids
    if (activeTab === TAB_ALL) currentUuidList = allUuids

    if (!currentUuidList) return

    async function fetchCurrentPage() {
      try {
        setLoading(true)
        const currentLimit = limit
        const offset = (currentPage - 1) * currentLimit
        const pageUuids = currentUuidList.slice(offset, offset + currentLimit)

        if (pageUuids.length === 0) {
          setPlants([])
          setLoading(false)
          return
        }

        const response = await apiClient.get(
          `/plants?uuids=${pageUuids.join(',')}&limit=${currentLimit}&${commonParams}`,
        )
        setPlants(response.items || [])
        setError(null)
      } catch (err) {
        setError('Failed to load page data')
      } finally {
        setLoading(false)
      }
    }
    fetchCurrentPage()
  }, [activeTab, currentPage, todoUuids, doneUuids, allUuids, limit, operationMode])

  // Merge server data with progress buffer
  const displayedPlants = useMemo(() => {
    return plants.map((p) => {
      const key = p.uuid || p.id
      const buffered = progressBuffer[key]
      if (buffered) {
        return { ...p, ...buffered }
      }
      return p
    })
  }, [plants, progressBuffer])

  const filteredPlants = useMemo(() => {
    if (showAll) return displayedPlants

    let snapshot = allUuids
    if (activeTab === TAB_TODO) snapshot = todoUuids
    if (activeTab === TAB_DONE) snapshot = doneUuids

    if (snapshot === null) {
      if (activeTab === TAB_TODO) return displayedPlants.filter((p) => p.needs_weighing)
      return displayedPlants
    }

    return displayedPlants.filter((p) => snapshot.includes(p.uuid))
  }, [displayedPlants, showAll, activeTab, allUuids, todoUuids, doneUuids])

  let totalCount = 0
  if (activeTab === TAB_TODO) totalCount = todoUuids?.length || 0
  else if (activeTab === TAB_DONE) totalCount = doneUuids?.length || 0
  else if (activeTab === TAB_ALL) totalCount = allUuids?.length || 0

  const currentLimit = limit || 20
  const totalPages = Math.ceil(totalCount / currentLimit) || 0

  function handleTabChange(tab) {
    setSearchParams((prev) => {
      prev.set('tab', tab)
      return prev
    })
  }

  function handlePageChange(newPage) {
    setSearchParams((prev) => {
      let key = 'page_todo'
      if (activeTab === TAB_DONE) key = 'page_done'
      if (activeTab === TAB_ALL) key = 'page_all'
      prev.set(key, String(newPage))
      return prev
    })
  }

  function handleLimitChange(newLimit) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pageSize', String(newLimit))
    }
    setSearchParams((prev) => {
      // If we're on the All tab, the pageSize shown to the user is already doubled.
      // To keep it consistent when switching back to other tabs, we store the base limit.
      const baseLimit = newLimit
      prev.set('limit', String(baseLimit))
      prev.set('page_todo', '1')
      prev.set('page_done', '1')
      prev.set('page_all', '1')
      return prev
    })
  }

  async function handleWeightMeasurement(plantId, weightValue) {
    const numeric = Number(weightValue)
    if (Number.isNaN(numeric) || numeric < 0) {
      setInputStatus((prev) => ({ ...prev, [plantId]: 'error' }))
      return
    }

    const requestId = (pendingRequests.current[plantId] || 0) + 1
    pendingRequests.current[plantId] = requestId

    // Abort previous request for this plant
    if (abortControllers.current[plantId]) {
      abortControllers.current[plantId].abort()
    }
    const controller = new AbortController()
    abortControllers.current[plantId] = controller

    setInputStatus((prev) => ({ ...prev, [plantId]: 'saving' }))
    setProgressBuffer((prev) => ({
      ...prev,
      [plantId]: {
        ...(prev[plantId] || {}),
        current_weight: numeric,
        water_retained_pct:
          prev[plantId]?.water_retained_pct ??
          plants.find((p) => String(p.uuid || p.id) === String(plantId))?.water_retained_pct,
      },
    }))

    try {
      const existingId = measurementIds[plantId]
      const payload = {
        plant_id: plantId,
        measured_weight_g: numeric,
        measured_at: wateringTime.getCommitDateTime(),
      }

      let data
      if (existingId) {
        data = await measurementsApi.weight.update(plantId, existingId, payload, controller.signal)
      } else {
        data = await measurementsApi.weight.create(plantId, payload, controller.signal)
      }

      // If a newer request has been started for this plant, ignore this response
      if (pendingRequests.current[plantId] !== requestId) {
        return
      }

      const responseData = data?.status === 'success' && data?.data ? data.data : data

      // Update progress buffer using functional update for race condition safety.
      // Do NOT re-derive needs_water here: the backend (plants_list.py) is the single
      // source of truth. We re-fetch the authoritative plant state below.
      setProgressBuffer((prev) => {
        const prevData = prev[plantId] || {}
        const now = wateringTime.getCommitDateTime()
        return {
          ...prev,
          [plantId]: {
            ...prevData,
            ...responseData,
            current_weight: numeric,
            needs_weighing: false,
            latest_at:
              responseData?.latest_at ?? responseData?.measured_at ?? prevData.latest_at ?? now,
            measured_at: responseData?.measured_at ?? prevData.measured_at ?? now,
          },
        }
      })

      if (responseData?.id && !existingId) {
        setMeasurementIds((prev) => ({ ...prev, [plantId]: responseData.id }))
      }

      // Backend returned the authoritative needs_water in the save response;
      // apply it directly so the row reflects the new weight live (no extra GET).
      if (responseData?.needs_water !== undefined) {
        setPlants((prev) =>
          prev.map((p) =>
            String(p.uuid || p.id) === String(plantId)
              ? { ...p, needs_water: responseData.needs_water }
              : p,
          ),
        )
      }

      setInputStatus((prev) => ({ ...prev, [plantId]: 'success' }))
    } catch (err) {
      console.error('Error saving weight measurement:', err)
      if (err.message && err.message.toLowerCase().includes('measured weight is incorrect')) {
        setValidationError({ message: err.message, plantId })
      }
      setInputStatus((prev) => ({ ...prev, [plantId]: 'error' }))
    }
  }

  async function handleWeightDelete(plantId, measurementId) {
    setInputStatus((prev) => ({ ...prev, [plantId]: 'saving' }))
    try {
      await measurementsApi.delete(plantId, measurementId)

      // Remove from progress buffer
      setProgressBuffer((prev) => {
        const next = { ...prev }
        delete next[plantId]
        return next
      })

      setMeasurementIds((prev) => {
        const next = { ...prev }
        delete next[plantId]
        return next
      })
      setInputStatus((prev) => {
        const next = { ...prev }
        delete next[plantId]
        return next
      })
    } catch (err) {
      console.error('Error deleting measurement:', err)
      setInputStatus((prev) => ({ ...prev, [plantId]: 'error' }))
    }
  }

  const deemphasizePredicate = (p) => {
    return !p.needs_weighing
  }

  // Styles for tabs
  const tabContainerStyle = {
    display: 'flex',
    borderBottom: '1px solid #e5e7eb',
    marginBottom: '20px',
  }
  const getTabStyle = (active) => ({
    padding: '10px 20px',
    cursor: 'pointer',
    borderBottom: active ? '2px solid #3b82f6' : 'none',
    color: active ? '#3b82f6' : '#6b7280',
    fontWeight: active ? '600' : '400',
    background: 'none',
    borderTop: 'none',
    borderLeft: 'none',
    borderRight: 'none',
  })

  return (
    <DashboardLayout title="Bulk weight measurement">
      <PageHeader
        title="Bulk weight measurement"
        onBack={() => navigate('/daily')}
        titleBack="Daily Care"
      />

      <div
        className="actions"
        style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}
      >
        <button className="btn btn-primary" disabled={true}>
          Bulk measurement
          {todoUuids && todoUuids.filter((id) => !measurementIds[id]).length > 0
            ? ` (${todoUuids.filter((id) => !measurementIds[id]).length})`
            : ''}
        </button>
        <button
          className="btn"
          disabled={loading}
          style={{ background: '#2c4fff', color: 'white' }}
          onClick={() => navigate('/measurements/bulk/watering')}
        >
          Bulk watering
          {wateringUuids && wateringUuids.length > 0 ? ` (${wateringUuids.length})` : ''}
        </button>
      </div>

      <WateringTimeBar wateringTime={wateringTime} />

      <p>Start bulk weight measurement for all plants.</p>

      {operationMode === 'vacation' ? (
        <EmptyState
          title="Not available in Vacation mode"
          description={
            <>
              Bulk weight measurement is disabled while in vacation mode because watering is based
              on approximated schedules rather than manual weights.
              <br />
              You can change the mode in <Link to="/settings">Settings</Link>.
            </>
          }
        />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                aria-label="Show all plants"
              />
              Show all plants
            </label>
            <span style={{ fontSize: 12, color: 'var(--muted-fg, #6b7280)' }}>
              {showAll
                ? 'Showing all plants; those up to date are deemphasized.'
                : 'Showing only plants that need weighing.'}
            </span>
          </div>

          <div style={tabContainerStyle}>
            <button
              style={getTabStyle(activeTab === TAB_TODO)}
              onClick={() => handleTabChange(TAB_TODO)}
              aria-label={
                todoUuids
                  ? `To-Do (${todoUuids.filter((id) => !measurementIds[id]).length})`
                  : 'To-Do'
              }
            >
              To-Do {todoUuids && `(${todoUuids.filter((id) => !measurementIds[id]).length})`}
            </button>
            <button
              style={getTabStyle(activeTab === TAB_DONE)}
              onClick={() => handleTabChange(TAB_DONE)}
            >
              Up to Date {doneUuids && `(${doneUuids.length})`}
            </button>
            <button
              style={getTabStyle(activeTab === TAB_ALL)}
              onClick={() => handleTabChange(TAB_ALL)}
            >
              All {allUuids && `(${allUuids.length})`}
            </button>
          </div>

          <div style={{ marginBottom: 20 }}>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              pageSize={currentLimit}
              onPageSizeChange={handleLimitChange}
              total={totalCount}
              disabled={loading}
            />
          </div>

          {loading && <div>Loading...</div>}
          {error && !loading && <div className="text-danger">{error}</div>}

          {!loading && !error && (
            <BulkMeasurementTable
              plants={filteredPlants}
              inputStatus={inputStatus}
              onCommitValue={handleWeightMeasurement}
              onDeleteWatering={handleWeightDelete}
              measurementIds={measurementIds}
              onViewPlant={(p) => navigate(`/plants/${p.uuid}`, { state: { plant: p } })}
              firstColumnLabel="Weight gr, Water %"
              firstColumnTooltip="Enter the new total plant weight (in grams). We’ll compute updated water retention (%) after you finish input and leave the field."
              waterLossCellStyle={waterLossCellStyle}
              showUpdatedColumn={true}
              operationMode={operationMode}
              defaultThreshold={defaultThreshold}
              approximations={approximations}
              deemphasizePredicate={deemphasizePredicate}
              noPlantsMessage={
                activeTab === TAB_TODO
                  ? 'No plants need weighing'
                  : activeTab === TAB_DONE
                    ? 'No plants to show'
                    : 'No plants available'
              }
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={!!validationError}
        title="Incorrect Weight"
        message={validationError?.message}
        tone="warning"
        confirmText="Repot Plant"
        cancelText="Correct Weight"
        onConfirm={() => {
          const pid = validationError.plantId
          setValidationError(null)
          window.open(`/measurement/repotting?plant=${pid}`, '_blank')
        }}
        onCancel={() => setValidationError(null)}
      />
    </DashboardLayout>
  )
}
