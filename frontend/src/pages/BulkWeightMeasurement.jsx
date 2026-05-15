import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { measurementsApi } from '../api/measurements'
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

export default function BulkWeightMeasurement({ client = apiClient } = {}) {
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

  // Current page data
  const [plants, setPlants] = useState([])
  const [approximations, setApproximations] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)

  // Session progress buffer (persists across tab switches)
  const [progressBuffer, setProgressBuffer] = useState({})
  const [inputStatus, setInputStatus] = useState({})
  const [measurementIds, setMeasurementIds] = useState({})

  const commonParams = `operationMode=${operationMode}&defaultThreshold=${defaultThreshold}`

  // 1. Initial Load: Fetch stable UUID lists for both tabs and approximations
  useEffect(() => {
    if (operationMode === 'vacation') return

    async function init() {
      try {
        setLoading(true)
        const [todo, done, all, approxData] = await Promise.all([
          client.get(`/plants/uuids?needs_weighing=true&${commonParams}`),
          client.get(`/plants/uuids?needs_weighing=false&${commonParams}`),
          client.get(`/plants/uuids?${commonParams}`),
          client.get('/measurements/approximation/watering'),
        ])
        setTodoUuids(todo || [])
        setDoneUuids(done || [])
        setAllUuids(all || [])

        const approxItems = approxData?.items || []
        const approxMap = approxItems.reduce((acc, item) => {
          acc[item.plant_uuid] = item
          return acc
        }, {})
        setApproximations(approxMap)
      } catch (err) {
        setError('Failed to initialize plant lists')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [operationMode])

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

        const response = await client.get(
          `/plants?uuids=${pageUuids.join(',')}&limit=${currentLimit}&${commonParams}`,
        )
        setPlants(response.items || [])
      } catch (err) {
        setError('Failed to load page data')
      } finally {
        setLoading(false)
      }
    }
    fetchCurrentPage()
  }, [activeTab, currentPage, todoUuids, doneUuids, allUuids, limit, operationMode, client])

  // Merge server data with progress buffer
  const displayedPlants = useMemo(() => {
    return plants.map((p) => {
      const buffered = progressBuffer[p.uuid]
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
      // If we're in TODO tab, we filter by needs_weighing property
      if (activeTab === TAB_TODO) return displayedPlants.filter((p) => p.needs_weighing)
      return displayedPlants
    }

    // Once snapshots are available, we use them to ensure stability (so plants
    // don't disappear while weighing until the next page refresh).
    return displayedPlants.filter((p) => snapshot.includes(p.uuid))
  }, [displayedPlants, showAll, activeTab, todoUuids, doneUuids, allUuids])

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

    try {
      const existingId = measurementIds[plantId]
      const payload = {
        plant_id: plantId,
        measured_weight_g: numeric,
        measured_at: wateringTime.getCommitDateTime(),
      }

      let data
      if (existingId) {
        data = await measurementsApi.weight.update(existingId, payload, null, operationMode)
      } else {
        data = await measurementsApi.weight.create(payload, null, operationMode)
      }

      if (data && data.status === 'success' && data.data) {
        data = data.data
      }

      // Update progress buffer
      const updatedData = {
        current_weight: numeric,
        water_loss_total_pct: data?.water_loss_total_pct,
        water_retained_pct: data?.water_retained_pct,
        latest_at: data?.latest_at || data?.measured_at || wateringTime.getCommitDateTime(),
        measured_at: data?.measured_at,
        needs_weighing: data?.needs_weighing,
      }

      setProgressBuffer((prev) => ({
        ...prev,
        [plantId]: updatedData,
      }))

      if (data?.id && !existingId) {
        setMeasurementIds((prev) => ({ ...prev, [plantId]: data.id }))
      }

      setInputStatus((prev) => ({ ...prev, [plantId]: 'success' }))
    } catch (err) {
      console.error('Error saving weight measurement:', err)
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
              aria-label={todoUuids ? `To-Do (${todoUuids.length})` : 'To-Do'}
            >
              To-Do {todoUuids && `(${todoUuids.length})`}
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
    </DashboardLayout>
  )
}
