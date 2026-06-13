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
import { checkNeedsWater } from '../utils/watering'
import Pagination from '../components/Pagination.jsx'
import { apiClient } from '../api/client'
import '../styles/plants-list.css'

const TAB_TODO = 'todo'
const TAB_DONE = 'done'
const TAB_ALL = 'all'

export default function BulkWatering() {
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
  const [weighingUuids, setWeighingUuids] = useState(null)

  const pendingRequests = React.useRef({})
  const abortControllers = React.useRef({})

  // Current page data
  const [plants, setPlants] = useState([])
  const [isSnapshotBased, setIsSnapshotBased] = useState(false)
  const [approximations, setApproximations] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [validationError, setValidationError] = useState(null)
  const [showAll, setShowAll] = useState(false)

  // Session progress buffer (persists across tab switches)
  const [progressBuffer, setProgressBuffer] = useState({})
  const [inputStatus, setInputStatus] = useState({})
  const [measurementIds, setMeasurementIds] = useState({})

  const commonParams = `operationMode=${operationMode}&defaultThreshold=${defaultThreshold}`

  // 1. Initial Load: Fetch stable UUID lists for both tabs and approximations
  useEffect(() => {
    async function init() {
      try {
        setLoading(true)
        const [todo, done, all, approxData, weighing] = await Promise.all([
          apiClient.get(`/plants/uuids?needs_watering=true&${commonParams}`),
          apiClient.get(`/plants/uuids?needs_watering=false&${commonParams}`),
          apiClient.get(`/plants/uuids?${commonParams}`),
          apiClient.get('/plants/measurements/approximation/watering'),
          apiClient.get(`/plants/uuids?needs_weighing=true&${commonParams}`),
        ])
        setTodoUuids(todo || [])
        setDoneUuids(done || [])
        setAllUuids(all || [])
        setWeighingUuids(weighing || [])
        setError('')

        const approxItems = approxData?.items || []
        const approxMap = approxItems.reduce((acc, item) => {
          acc[item.plant_uuid] = item
          return acc
        }, {})
        setApproximations(approxMap)
      } catch (err) {
        console.error('Failed to load approximations', err)
        setError(err.body?.message || err.message || err.detail || 'Failed to load plants')
        // If snapshot fetching fails, initialize with empty arrays to allow fallback logic to proceed
        setTodoUuids((prev) => prev ?? [])
        setDoneUuids((prev) => prev ?? [])
        setAllUuids((prev) => prev ?? [])
        setWeighingUuids((prev) => prev ?? [])
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [operationMode, commonParams])

  // 2. Data Fetching: Load full objects directly (server paginates). Keep it simple and stable for UX/tests.
  useEffect(() => {
    async function fetchCurrentPage() {
      const hasSnapshots = todoUuids !== null && doneUuids !== null && allUuids !== null

      // Wait for snapshots to ensure stability and avoid logic duplication with BE
      if (!hasSnapshots) return

      try {
        setLoading(true)

        let url = `/plants?limit=${limit}&${commonParams}`

        if (hasSnapshots) {
          let currentUuids = allUuids
          if (activeTab === TAB_TODO) currentUuids = todoUuids
          if (activeTab === TAB_DONE) currentUuids = doneUuids

          if (currentUuids.length === 0) {
            setPlants([])
            setLoading(false)
            return
          }

          const currentLimit = limit
          const start = (currentPage - 1) * currentLimit
          const pageUuids = currentUuids.slice(start, start + currentLimit)
          url = `/plants?uuids=${pageUuids.join(',')}&page=1&limit=${currentLimit}&${commonParams}`
        }

        const response = await apiClient.get(url)
        setPlants(Array.isArray(response?.items) ? response.items : [])
        setError('')
      } catch (err) {
        setError(err.body?.message || err.message || err.detail || 'Failed to load plants')
      } finally {
        setLoading(false)
      }
    }
    fetchCurrentPage()
  }, [activeTab, currentPage, limit, operationMode, todoUuids, doneUuids, allUuids])

  // Merge server data with progress buffer
  const displayedPlants = plants.map((p) => {
    const key = p.uuid || p.id
    const buffered = progressBuffer[key]
    if (buffered) {
      return { ...p, ...buffered }
    }
    return p
  })

  // Plants stay in the list until page refresh to provide stable UX.
  // We use the initial snapshots to keep the list stable even as plants are watered.
  const filteredPlants = (() => {
    if (showAll) return displayedPlants

    // Select stable snapshot for current tab
    let snapshot = allUuids
    if (activeTab === TAB_TODO) snapshot = todoUuids
    if (activeTab === TAB_DONE) snapshot = doneUuids

    // If snapshots are not available yet (initial fetch or tests), we trust the
    // server-side filtering performed in fetchCurrentPage.
    if (snapshot === null) {
      return displayedPlants
    }

    // Once snapshots are available, we use them to ensure stability (so plants
    // don't disappear while watering until the next page refresh).
    return displayedPlants.filter((p) => snapshot.includes(p.uuid))
  })()

  let totalCount = 0
  if (activeTab === TAB_TODO) totalCount = todoUuids?.length || 0
  else if (activeTab === TAB_DONE) totalCount = doneUuids?.length || 0
  else if (activeTab === TAB_ALL) totalCount = allUuids?.length || 0

  const currentLimit = limit
  const totalPages = Math.ceil(totalCount / currentLimit)

  function handleTabChange(tab) {
    if (tab !== activeTab) setLoading(true)
    setSearchParams((prev) => {
      prev.set('tab', tab)
      return prev
    })
  }

  function handlePageChange(newPage) {
    setLoading(true)
    setSearchParams((prev) => {
      let key = 'page_todo'
      if (activeTab === TAB_DONE) key = 'page_done'
      if (activeTab === TAB_ALL) key = 'page_all'
      prev.set(key, String(newPage))
      return prev
    })
  }

  function handleLimitChange(newLimit) {
    setLoading(true)
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

  async function handleWateringCommit(plantId, newWeightValue) {
    const numeric = Number(newWeightValue)
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

    // Optimistic status and buffer update
    setInputStatus((prev) => ({ ...prev, [plantId]: 'saving' }))
    setProgressBuffer((prev) => ({
      ...prev,
      [plantId]: {
        ...(prev[plantId] || {}),
        current_weight: numeric,
        water_retained_pct:
          prev[plantId]?.water_retained_pct ??
          plants.find((p) => (p.uuid || p.id) === plantId)?.water_retained_pct,
      },
    }))

    try {
      const existingId = measurementIds[plantId]
      const payload = {
        plant_id: plantId,
        last_wet_weight_g: numeric,
        measured_at: wateringTime.getCommitDateTime(),
      }

      let data
      if (existingId) {
        data = await measurementsApi.watering.update(
          plantId,
          existingId,
          payload,
          controller.signal,
        )
      } else {
        data = await measurementsApi.watering.create(plantId, payload, controller.signal)
      }

      // If a newer request has been started for this plant, ignore this response
      if (pendingRequests.current[plantId] !== requestId) {
        return
      }

      const responseData = data?.status === 'success' && data?.data ? data.data : data

      // Update progress buffer
      setProgressBuffer((prev) => {
        const currentPlant = plants.find((p) => (p.uuid || p.id) === plantId)
        const prevData = prev[plantId] || currentPlant || {}
        const now = wateringTime.getCommitDateTime()
        return {
          ...prev,
          [plantId]: {
            ...prevData,
            ...responseData,
            current_weight: numeric,
            latest_at:
              responseData?.latest_at ?? responseData?.measured_at ?? prevData.latest_at ?? now,
            measured_at: responseData?.measured_at ?? prevData.measured_at ?? now,
          },
        }
      })

      if (responseData?.id && !existingId) {
        setMeasurementIds((prev) => ({ ...prev, [plantId]: responseData.id }))
      }

      setInputStatus((prev) => ({ ...prev, [plantId]: 'success' }))
    } catch (err) {
      if (err.name === 'AbortError') return // Ignore if superseded
      console.error('Error saving watering measurement:', err)
      if (err.message && err.message.toLowerCase().includes('measured weight is incorrect')) {
        setValidationError({ message: err.message, plantId })
      }
      setInputStatus((prev) => ({ ...prev, [plantId]: 'error' }))
    }
  }

  async function handleWateringDelete(plantId, measurementId) {
    setInputStatus((prev) => ({ ...prev, [plantId]: 'saving' }))
    try {
      await measurementsApi.delete(plantId, measurementId)

      // Remove from progress buffer (or set to null to revert to original)
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
      console.error('Error deleting watering:', err)
      setInputStatus((prev) => ({ ...prev, [plantId]: 'error' }))
    }
  }

  async function handleVacationWateringCommit(plantId) {
    setInputStatus((prev) => ({ ...prev, [plantId]: 'saving' }))
    try {
      const data = await measurementsApi.watering.createVacation(plantId, {
        plant_id: plantId,
        measured_at: wateringTime.getCommitDateTime(),
      })
      const measurement = data?.data || data
      if (measurement?.id) {
        setMeasurementIds((prev) => ({ ...prev, [plantId]: measurement.id }))
        setInputStatus((prev) => ({ ...prev, [plantId]: 'success' }))

        const updatedData = {
          water_loss_total_pct: measurement.water_loss_total_pct,
          water_retained_pct: measurement.water_retained_pct,
          latest_at:
            measurement.latest_at || measurement.measured_at || wateringTime.getCommitDateTime(),
          measured_at: measurement.measured_at,
        }

        setProgressBuffer((prev) => ({
          ...prev,
          [plantId]: updatedData,
        }))

        // Refresh approximations for this plant
        try {
          const approxData = await apiClient.get('/plants/measurements/approximation/watering')
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
        setInputStatus((prev) => ({ ...prev, [plantId]: 'error' }))
      }
    } catch (err) {
      console.error('Error saving vacation watering:', err)
      setInputStatus((prev) => ({ ...prev, [plantId]: 'error' }))
    }
  }

  async function handleVacationWateringDelete(plantId, measurementId) {
    setInputStatus((prev) => ({ ...prev, [plantId]: 'saving' }))
    try {
      await measurementsApi.delete(plantId, measurementId)

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

      // Refresh approximations
      try {
        const approxData = await apiClient.get('/plants/measurements/approximation/watering')
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
      setInputStatus((prev) => ({ ...prev, [plantId]: 'error' }))
    }
  }

  const deemphasizePredicate = (p) => {
    const approx = approximations[p.uuid]
    return !checkNeedsWater(p, operationMode, approx, defaultThreshold)
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
    <DashboardLayout title="Bulk watering">
      <PageHeader title="Bulk watering" onBack={() => navigate('/daily')} titleBack="Daily Care" />

      <div
        className="actions"
        style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}
      >
        <button
          className="btn btn-primary"
          disabled={operationMode === 'vacation' || loading}
          title={operationMode === 'vacation' ? 'Bulk measurement is currently disabled' : ''}
          onClick={() => navigate('/measurements/bulk/weight')}
        >
          Bulk measurement
          {weighingUuids && weighingUuids.length > 0 ? ` (${weighingUuids.length})` : ''}
        </button>
        <button className="btn" disabled={true} style={{ background: '#2c4fff', color: 'white' }}>
          Bulk watering
          {todoUuids && todoUuids.filter((id) => !measurementIds[id]).length > 0
            ? ` (${todoUuids.filter((id) => !measurementIds[id]).length})`
            : ''}
        </button>
      </div>

      <WateringTimeBar wateringTime={wateringTime} />

      <p>
        {operationMode === 'vacation'
          ? 'Click the water drop icon to record watering based on historical data.'
          : 'Enter the new weight after watering.'}{' '}
        {operationMode === 'vacation'
          ? 'By default, we show only plants that need water according to the approximation schedule.'
          : 'By default, we show only plants that need water (retained ≤ threshold).'}
      </p>

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
            ? 'Showing all plants; those above threshold are deemphasized.'
            : operationMode === 'vacation'
              ? 'Showing only plants that need watering according to the approximation schedule.'
              : 'Showing only plants that need watering (retained ≤ threshold).'}
        </span>
      </div>

      <>
        <div style={tabContainerStyle}>
          <button
            style={getTabStyle(activeTab === TAB_TODO)}
            onClick={() => handleTabChange(TAB_TODO)}
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
            onCommitValue={handleWateringCommit}
            onDeleteWatering={handleWateringDelete}
            onCommitVacationWatering={handleVacationWateringCommit}
            onDeleteVacationWatering={handleVacationWateringDelete}
            measurementIds={measurementIds}
            onViewPlant={(p) => navigate(`/plants/${p.uuid}`, { state: { plant: p } })}
            firstColumnLabel="Water: Retained %, Next date"
            firstColumnTooltip="Manual/Automatic: Enter weight in grams. Vacation: Record watering icon. Column also shows water retained (%) and next scheduled watering."
            waterLossCellStyle={waterLossCellStyle}
            showUpdatedColumn={true}
            operationMode={operationMode}
            defaultThreshold={defaultThreshold}
            approximations={approximations}
            deemphasizePredicate={deemphasizePredicate}
            noPlantsMessage={showAll ? 'No plants available' : 'No plants need watering'}
          />
        )}
      </>
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
