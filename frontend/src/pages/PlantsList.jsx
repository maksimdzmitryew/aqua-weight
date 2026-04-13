import React, { useEffect, useMemo, useState, useRef } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
import IconButton from '../components/IconButton.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useLocation as useRouterLocation, useNavigate, useSearchParams } from 'react-router-dom'
import QuickCreateButtons from '../components/QuickCreateButtons.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { Link } from 'react-router-dom'
import { plantsApi } from '../api/plants'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import EmptyState from '../components/feedback/EmptyState.jsx'
import { getWaterRetainCellStyle, getWaterLossCellStyle } from '../utils/water_retained_colors.js'
import { getWaterRetainedPct } from '../utils/watering.js'
import '../styles/plants-list.css'
import Badge from '../components/Badge.jsx'
import SearchField from '../components/SearchField.jsx'
import Pagination from '../components/Pagination.jsx'
import DriftNotification from '../components/DriftNotification.jsx'

export default function PlantsList() {
  // URL-based state management
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '20', 10)
  const searchQuery = searchParams.get('search') || ''

  // Component state
  const [plants, setPlants] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const [showDriftNotification, setShowDriftNotification] = useState(false)

  // Drift detection
  const previousTotalRef = useRef(null)

  const navigate = useNavigate()
  const routerLocation = useRouterLocation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const operationMode = useMemo(() => localStorage.getItem('operationMode') || 'manual', [])

  // Sync local search input with URL query param
  // This ensures the search field shows the current filter even after page loads/reloads
  const [query, setQuery] = useState(searchQuery)
  useEffect(() => {
    setQuery(searchQuery)
  }, [searchQuery])

  // Validate page number - redirect to page 1 if invalid
  useEffect(() => {
    if (page < 1 || (totalPages > 0 && page > totalPages)) {
      const newParams = new URLSearchParams(searchParams)
      newParams.set('page', '1')
      setSearchParams(newParams, { replace: true })
    }
  }, [page, totalPages, searchParams, setSearchParams])

  // Load plants data with pagination
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        setLoading(true)
        setError('')

        // Fetch paginated plants
        const response = await plantsApi.list({
          page,
          limit,
          search: searchQuery,
          signal: controller.signal
        })

        // Check for drift using global_total (unfiltered count of all active plants)
        // This ensures drift detection is independent of search filters
        if (previousTotalRef.current !== null && previousTotalRef.current !== response.global_total) {
          setShowDriftNotification(true)
        }
        previousTotalRef.current = response.global_total

        const plantsData = response.items || []

        // Fetch approximations for vacation mode
        try {
          const approx = await plantsApi.getApproximation(controller.signal)
          const approxMap = (approx?.items || []).reduce((acc, item) => {
            acc[item.plant_uuid] = item
            return acc
          }, {})

          const enrichedPlants = plantsData.map((p) => {
            const a = approxMap[p.uuid]
            const merged = { ...p }
            if (a) {
              merged.frequency_days = a.frequency_days
              merged.frequency_confidence = a.frequency_confidence
              merged.next_watering_at = a.next_watering_at
              merged.first_calculated_at = a.first_calculated_at
              merged.days_offset = a.days_offset
            }
            merged._approximation = a
            return merged
          })

          setPlants(enrichedPlants)
        } catch (e) {
          console.error('Failed to load approximations', e)
          setPlants(plantsData)
        }

        setTotal(response.total ?? 0)
        setTotalPages(response.total_pages ?? 0)
      } catch (e) {
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (!isAbort) setError(msg || 'Failed to load plants')
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => {
      controller.abort()
    }
  }, [page, limit, searchQuery])

  useEffect(() => {
    const updated = routerLocation.state && routerLocation.state.updatedPlant
    if (updated) {
      setPlants((prev) => prev.map((it) => (it.uuid === updated.uuid ? updated : it)))
      // clear navigation state to avoid reapplying on refresh/back
      /* c8 ignore start - navigate failures are environment-specific and safely ignored */
      try {
        // Replace current entry and clear transient state the React Router way
        navigate(routerLocation.pathname, { replace: true, state: null })
      } catch {}
      /* c8 ignore stop */
    }
  }, [routerLocation.state, routerLocation.pathname])

  // URL parameter handlers
  const handlePageChange = (newPage) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page', String(newPage))
    setSearchParams(newParams)
  }

  const handlePageSizeChange = (newLimit) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('limit', String(newLimit))
    newParams.set('page', '1') // Reset to first page when changing page size
    setSearchParams(newParams)
  }

  const handleSearchChange = (newQuery) => {
    setQuery(newQuery)
    const newParams = new URLSearchParams(searchParams)
    if (newQuery.trim()) {
      newParams.set('search', newQuery.trim())
    } else {
      newParams.delete('search')
    }
    newParams.set('page', '1') // Reset to first page when searching
    setSearchParams(newParams)
  }

  // Drift notification handlers
  const handleRefresh = () => {
    setShowDriftNotification(false)
    window.location.reload()
  }

  const handleDismissDrift = () => {
    setShowDriftNotification(false)
  }

  function handleView(p) {
    if (!p?.uuid) return
    navigate(`/plants/${p.uuid}`, { state: { plant: p } })
  }

  function handleEdit(p) {
    const uid = p?.uuid
    if (!uid) return
    navigate(`/plants/${uid}/edit`, { state: { plant: p } })
  }

  function handleDelete(p) {
    setToDelete(p)
    setConfirmOpen(true)
  }

  function reorder(list, startIndex, endIndex) {
    const result = list.slice()
    const [removed] = result.splice(startIndex, 1)
    result.splice(endIndex, 0, removed)
    return result
  }

  async function persistOrder(newList) {
    setSaveError('')
    const orderedIds = newList.map((p) => p.uuid).filter(Boolean)
    if (orderedIds.length !== newList.length) return
    try {
      await plantsApi.reorder(orderedIds)
    } catch (e) {
      setSaveError(e?.message || 'Failed to save order')
    }
  }

  function onDragStart(index) {
    setDragIndex(index)
  }

  function onDragOver(e, index) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    setPlants((prev) => reorder(prev, dragIndex, index))
    setDragIndex(index)
  }

  function onDragEnd() {
    if (dragIndex === null) return
    persistOrder(plants)
    setDragIndex(null)
  }

  function moveItem(from, to) {
    /* c8 ignore next */
    if (from === to || from < 0 || to < 0 || from >= plants.length || to >= plants.length) return
    const newList = reorder(plants, from, to)
    setPlants(newList)
    persistOrder(newList)
  }

  function moveUp(index) {
    moveItem(index, index - 1)
  }

  function moveDown(index) {
    moveItem(index, index + 1)
  }

  function closeDialog() {
    setConfirmOpen(false)
    setToDelete(null)
  }

  async function confirmDelete() {
    /* c8 ignore start - defensive branch only triggered by external programmatic calls */
    if (!toDelete) { closeDialog(); return }
    /* c8 ignore stop */
    try {
      setSaveError('')
      const uuid = toDelete.uuid
      if (!uuid) {
        setSaveError('Cannot delete this plant: missing identifier')
        return
      }
      await plantsApi.remove(uuid)
      setPlants((prev) => prev.filter((it) => it.uuid !== toDelete.uuid))
      setTotal((prev) => Math.max(0, (prev ?? 0) - 1))
    } catch (e) {
      setSaveError(e?.message || 'Failed to delete plant')
    } finally {
      closeDialog()
    }
  }

  // Plants are already filtered and paginated by the server
  const displayedPlants = plants

  return (
    <DashboardLayout title="Plants">
      <PageHeader
        title="Plants"
        onBack={() => navigate('/dashboard')}
        titleBack="Dashboard"
        onCreate={() => navigate('/plants/new')}
      />

      <p>List of all available plants.</p>

      {loading && <Loader label="Loading plants…" />}
      {error && !loading && <ErrorNotice message={error} onRetry={() => window.location.reload()} />}
      {saveError && !loading && <ErrorNotice message={saveError} />}

      {!loading && !error && (
        <>
          {/* Search field - always visible regardless of results */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}>
            <SearchField
              value={query}
              onChange={handleSearchChange}
              placeholder="Search name, notes, location… or type a number to filter by threshold"
              ariaLabel="Search plants"
              autoFocus={false}
            />
          </div>

          {/* Active filter indicator */}
          {searchQuery && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              margin: '0 0 12px 0',
              background: '#f3f4f6',
              borderRadius: 6,
              fontSize: 14,
              color: '#374151'
            }}>
              <span>Filtered by: <strong>"{searchQuery}"</strong></span>
              <button
                onClick={() => handleSearchChange('')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  fontSize: 16,
                  color: '#6b7280',
                  lineHeight: 1
                }}
                aria-label="Clear filter"
                title="Clear filter"
              >
                ×
              </button>
            </div>
          )}

          {/* Drift detection notification */}
          {showDriftNotification && (
            <DriftNotification onRefresh={handleRefresh} onDismiss={handleDismissDrift} />
          )}

          {/* Conditional content based on results */}
          {total === 0 ? (
            searchQuery ? (
              // Empty search results - user filtered but got nothing
              <EmptyState
                title={`No plants found for "${searchQuery}"`}
                description="Try a different search term or clear the filter to see all plants."
              >
                <button className="btn btn-primary" onClick={() => handleSearchChange('')}>
                  Clear search
                </button>
              </EmptyState>
            ) : (
              // Truly empty database - no plants exist at all
              <EmptyState title="No plants" description="Get started by creating your first plant.">
                <button className="btn btn-primary" onClick={() => navigate('/plants/new')}>New plant</button>
              </EmptyState>
            )
          ) : (
            <div className="overflow-x-auto">

            {/* Pagination controls (top) */}
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              pageSize={limit}
              onPageSizeChange={handlePageSizeChange}
              total={total}
              disabled={loading}
            />

            <table className="table plants-table">
              <thead>
                <tr>
                  <th className="th" scope="col" title="Current retained water percentage and quick actions">
                    Care, Water retained <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th" scope="col" title="Watering threshold — water when retained ≤ value">
                    Thresh <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th" scope="col" title="Watering frequency">
                    Frequency <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th" scope="col" title="Next planned watering date">
                    Next watering <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th" scope="col" title="Plant name">
                    Name <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th" scope="col" title="Notes">
                    Notes <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th hide-column-phone" scope="col" title="Location">
                    Location <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th hide-column-tablet" scope="col" title="Last update time">
                    Updated <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th right" scope="col" title="Row actions">
                    Actions <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedPlants.map((p, idx) => {
                  const retained = getWaterRetainedPct(p, operationMode, p._approximation)
                  const displayRetained = typeof retained === 'number' ? `${retained}%` : retained
                  const thresh = Number(p.recommended_water_threshold_pct)
                  const needsWater = typeof retained === 'number' && !Number.isNaN(thresh) && retained <= thresh
                  // Disable drag/reorder when searching or not on page 1
                  const canReorder = !searchQuery && page === 1
                  return (
                  <tr key={p.uuid || idx}
                      draggable={canReorder}
                      onDragStart={canReorder ? () => onDragStart(idx) : undefined}
                      onDragEnd={canReorder ? onDragEnd : undefined}
                      onDragOver={canReorder ? (e) => onDragOver(e, idx) : undefined}
                  >
                    <td className="td" title={p.uuid ? 'View plant' : undefined}>
                      <span style={{ display: 'inline-flex', gap: '10px', alignItems: 'center' }}>
                        <QuickCreateButtons plantUuid={p.uuid} plantName={p.name} compact={true}/>
                        {displayRetained}
                        {needsWater && (
                          <Badge tone="warning" title={operationMode === 'vacation' ? "Needs water based on approximation" : "Needs water based on threshold"}>Needs water</Badge>
                        )}
                        {p.needs_weighing && (
                           <Badge tone="info" title="Needs weighing (>18h since last update)">Needs weight</Badge>
                        )}
                      </span>
                    </td>
                    <td className="td">
                        {p.recommended_water_threshold_pct}%
                    </td>
                    {/* Frequency */}
                    <td className="td">
                      {Number.isFinite(p?.frequency_days) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {p.frequency_days} d
                          {p.frequency_confidence !== undefined && (
                            <span
                              title={`${p.frequency_confidence} watering events used for calculation`}
                              style={{
                                fontSize: '0.8em',
                                color: `rgba(var(--text-rgb, 107, 114, 128), ${Math.min(1, 0.3 + (p.frequency_confidence / 10))})`,
                              }}
                            >
                               &nbsp;({p.frequency_confidence})
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    {/* Next watering (date only, DD/MM or MM/DD per user preference) */}
                    <td className="td" style={operationMode === 'vacation' && p.days_offset < 0 ? { background: '#fecaca' } : {}}>
                      <DateTimeText value={p.first_calculated_at || p.next_watering_at} mode="daymonth" showTooltip={false} />
                      {p.days_offset !== undefined && p.days_offset !== null && (
                        <span style={{ marginLeft: 4, fontSize: '0.9em', opacity: 0.8 }}>
                          ({p.days_offset}d)
                        </span>
                      )}
                    </td>
                    <td className="td" style={{ width: 140, ...(getWaterRetainCellStyle(retained)  || {}) }} title={p.uuid ? 'View plant' : undefined}>
                        {p.uuid ? (
                        <Link to={`/plants/${p.uuid}`} state={{ plant: p }} className="block-link">
                             {p.identify_hint} {p.name}
                        </Link>
                      ) : (
                        p.name
                      )}
                    </td>
                    <td className="td" title={p.uuid ? 'View plant' : undefined}>
                      {p.uuid ? (
                        <Link to={`/plants/${p.uuid}`} state={{ plant: p }} className="block-link">
                            {p.notes || '—'}
                        </Link>
                      ) : (
                        p.notes || '—'
                      )}
                    </td>
                    <td className="td hide-column-phone" style={{ width: 100 }}>{p.location || '—'}</td>
                    <td className="td hide-column-tablet">
                      <DateTimeText value={p.latest_at} />
                    </td>
                    <td className="td text-right nowrap">
                      <IconButton icon="view" label={`View plant ${p.name}`} onClick={() => handleView(p)} variant="ghost" />
                      <IconButton icon="edit" label={`Edit plant ${p.name}`} onClick={() => handleEdit(p)} variant="subtle" />
                      <IconButton icon="delete" label={`Delete plant ${p.name}`} onClick={() => handleDelete(p)} variant="danger" />
                      <button
                        type="button"
                        onClick={() => moveUp(idx)}
                        disabled={!canReorder || idx === 0}
                        aria-label={`Move ${p.name} up`}
                        title={canReorder ? "Move up" : "Reordering only available on page 1 without search"}
                        style={{ padding: '2px 6px', marginRight: 4, borderRadius: 4 }}
                      >↑</button>
                      <button
                        type="button"
                        onClick={() => moveDown(idx)}
                        disabled={!canReorder || idx === displayedPlants.length - 1}
                        aria-label={`Move ${p.name} down`}
                        title={canReorder ? "Move down" : "Reordering only available on page 1 without search"}
                        style={{ padding: '2px 6px', borderRadius: 4 }}
                      >↓</button>
                      <span
                        className="drag-handle"
                        title={canReorder ? "Drag to reorder" : "Reordering only available on page 1 without search"}
                        aria-label="Drag to reorder"
                        tabIndex={canReorder ? 0 : -1}
                        style={{ marginLeft: 8, opacity: canReorder ? 1 : 0.5 }}
                      >⋮⋮</span>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>

            {/* Pagination controls (bottom) */}
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              pageSize={limit}
              onPageSizeChange={handlePageSizeChange}
              total={total}
              disabled={loading}
            />
          </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={toDelete ? `Delete ${toDelete.name}` : 'Delete'}
        message="This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        icon="danger"
        onConfirm={confirmDelete}
        onCancel={closeDialog}
      />
    </DashboardLayout>
  )
}