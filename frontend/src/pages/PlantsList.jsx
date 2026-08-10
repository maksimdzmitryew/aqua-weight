import React, { useEffect, useMemo, useState, useRef } from 'react'
import { flushSync } from 'react-dom'
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
import { getWaterRetainCellStyle } from '../utils/water_retained_colors.js'
import { checkNeedsWater, getWaterRetainedPct } from '../utils/watering.js'
import '../styles/plants-list.css'
import Badge from '../components/Badge.jsx'
import StatusIcon from '../components/StatusIcon.jsx'
import SearchField from '../components/SearchField.jsx'
import Pagination from '../components/Pagination.jsx'
import DriftNotification from '../components/DriftNotification.jsx'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const SORTABLE_COLUMNS = {
  care: { label: 'Care', field: 'water_retained_pct' },
  freq: { label: 'Freq', field: 'frequency_days' },
  next: { label: 'Next', field: 'next_watering_at' },
  name: { label: 'Name', field: 'name' },
  notes: { label: 'Notes', field: 'notes' },
  location: { label: 'Location', field: 'location' },
  updated: { label: 'Updated', field: 'latest_at' },
}

function SortablePlantRow({
  p,
  idx,
  canReorder,
  operationMode,
  defaultThreshold,
  handleView,
  handleEdit,
  handleDelete,
  moveUp,
  moveDown,
  displayedPlantsCount,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.uuid,
    disabled: !canReorder || !p.uuid,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const retained = getWaterRetainedPct(p, operationMode, p._approximation)
  const minThreshPct = p?.recommended_water_threshold_pct
  const minThreshText = typeof minThreshPct === 'number' ? `${minThreshPct}` : '—'
  const retainedText = typeof retained === 'number' ? `${retained}` : '—'
  const minWithRetainedText = `${minThreshText}/${retainedText}`
  const needsWater = checkNeedsWater(p)

  return (
    <tr ref={setNodeRef} style={style} className={isDragging ? 'plant-row-dragging' : ''}>
      <td className="td" title={p.uuid ? 'View plant' : undefined} style={{ minWidth: 180 }}>
        <span style={{ display: 'inline-flex', gap: '10px', alignItems: 'center' }}>
          {p.archive !== 1 && (
            <QuickCreateButtons
              plantUuid={p.uuid}
              plantName={p.name}
              compact={true}
              highlightWater={needsWater}
            />
          )}
          {p.archive === 1 && (
            <span title="Archived" style={{ fontSize: '1.2em' }}>
              📦
            </span>
          )}
          {p.archive !== 1 && minWithRetainedText}
          {p.archive === 1 ? (
            <Badge tone="subtle" title="Plant is archived">
              Archived
            </Badge>
          ) : (
            needsWater && (
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span className="badge-text-desktop">
                  <Badge
                    tone="warning"
                    title={
                      operationMode === 'vacation'
                        ? 'Needs water based on approximation'
                        : 'Needs water based on threshold'
                    }
                  >
                    Needs water
                  </Badge>
                </span>
              </span>
            )
          )}
          {p.archive !== 1 && p.needs_weighing && (
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span className="badge-text-desktop">
                <Badge tone="info" title="Needs weighing (>18h since last update)">
                  Needs weight
                </Badge>
              </span>
              <span className="mobile-only-icon">
                <StatusIcon type="measure" active={true} />
              </span>
            </span>
          )}
        </span>
      </td>
      <td
        className="td"
        style={{ minWidth: 200, width: 140, ...(getWaterRetainCellStyle(retained) || {}) }}
        title={p.uuid ? 'View plant' : undefined}
      >
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
      <td className="td hide-column-phone">
        {Number.isFinite(p?.frequency_days) ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {p.frequency_days} d
            {p.frequency_confidence !== undefined && (
              <span
                title={`${p.frequency_confidence} watering events used for calculation`}
                style={{
                  fontSize: '0.8em',
                  color: `rgba(var(--text-rgb, 107, 114, 128), ${Math.min(
                    1,
                    0.3 + p.frequency_confidence / 10,
                  )})`,
                }}
              >
                &nbsp;({p.frequency_confidence})
              </span>
            )}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td
        className="td hide-column-phone"
        style={operationMode === 'vacation' && p.days_offset < 0 ? { background: '#fecaca' } : {}}
      >
        <DateTimeText
          value={p.first_calculated_at || p.next_watering_at}
          mode="daymonth"
          showTooltip={false}
        />
        {p.days_offset !== undefined && p.days_offset !== null && (
          <span style={{ marginLeft: 4, fontSize: '0.9em', opacity: 0.8 }}>({p.days_offset}d)</span>
        )}
      </td>
      <td className="td hide-column-phone" style={{ minWidth: 110, width: 120 }}>
        {p.location || '—'}
      </td>
      <td className="td hide-column-tablet" style={{ minWidth: 120, width: 180 }}>
        <DateTimeText value={p.latest_at} mode="shortdatetime" />
      </td>
      <td className="td text-right nowrap">
        <IconButton
          icon="view"
          label={`View plant ${p.name}`}
          onClick={() => handleView(p)}
          variant="ghost"
        />
        <IconButton
          icon="edit"
          label={`Edit plant ${p.name}`}
          onClick={() => handleEdit(p)}
          variant="subtle"
        />
        <IconButton
          icon="delete"
          label={`Delete plant ${p.name}`}
          onClick={() => handleDelete(p)}
          variant="danger"
        />
        <button
          type="button"
          onClick={() => moveUp(idx)}
          disabled={!canReorder || idx === 0}
          aria-label={`Move ${p.name} up`}
          title={canReorder ? 'Move up' : 'Reordering only available on page 1 without search'}
          style={{ padding: '2px 6px', marginRight: 4, borderRadius: 4 }}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => moveDown(idx)}
          disabled={!canReorder || idx === displayedPlantsCount - 1}
          aria-label={`Move ${p.name} down`}
          title={canReorder ? 'Move down' : 'Reordering only available on page 1 without search'}
          style={{ padding: '2px 6px', borderRadius: 4 }}
        >
          ↓
        </button>
        <span
          className="drag-handle"
          {...attributes}
          {...listeners}
          title={
            canReorder ? 'Drag to reorder' : 'Reordering only available on page 1 without search'
          }
          aria-label="Drag to reorder"
          tabIndex={canReorder ? 0 : -1}
          style={{ marginLeft: 8, opacity: canReorder ? 1 : 0.5 }}
        >
          ⋮⋮
        </span>
      </td>
    </tr>
  )
}

export default function PlantsList() {
  // URL-based state management
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || localStorage.getItem('pageSize') || '20', 10)
  const searchQuery = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'active'

  // Component state
  const [plants, setPlants] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [showDriftNotification, setShowDriftNotification] = useState(false)
  const [sortConfig, setSortConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('plantsListSort')
      const parsed = saved ? JSON.parse(saved) : { column: 'sort_order', direction: 'asc' }
      // Backward compatibility: if a removed column was saved, fall back to a visible one.
      if (parsed?.column === 'thresh') return { column: 'care', direction: 'asc' }
      return parsed
    } catch {
      return { column: 'sort_order', direction: 'asc' }
    }
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = (event) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = plants.findIndex((i) => i.uuid === active.id)
      const newIndex = plants.findIndex((i) => i.uuid === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(plants, oldIndex, newIndex)
        setPlants(newOrder)
        persistOrder(newOrder)
      }
    }
  }

  // Drift detection
  const previousTotalRef = useRef(null)

  const navigate = useNavigate()
  const routerLocation = useRouterLocation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const operationMode = useMemo(() => localStorage.getItem('operationMode') || 'manual', [])
  const defaultThreshold = useMemo(() => localStorage.getItem('defaultThreshold') || '40', [])

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
          status,
          signal: controller.signal,
          sortBy: sortConfig.column,
          sortDir: sortConfig.direction,
        })

        // Check for drift using global_total (unfiltered count of all active plants)
        // This ensures drift detection is independent of search filters
        if (
          previousTotalRef.current !== null &&
          previousTotalRef.current !== response.global_total
        ) {
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
        setLoading(false)
      } catch (e) {
        if (controller.signal.aborted) return
        setLoading(false)
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (isAbort) return
        setError(msg || 'Failed to load plants')
      }
    }
    load()
    return () => {
      controller.abort()
    }
  }, [page, limit, searchQuery, status, sortConfig])

  useEffect(() => {
    const updated = routerLocation.state && routerLocation.state.updatedPlant
    if (updated) {
      setPlants((prev) => prev.map((it) => (it.uuid === updated.uuid ? updated : it)))
      // clear navigation state to avoid reapplying on refresh/back
      /* c8 ignore start - navigate failures are environment-specific and safely ignored */
      try {
        // Replace current entry and clear transient state the React Router way
        navigate(routerLocation.pathname, { replace: true, state: null })
      } catch {
        // ignore
      }
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
    localStorage.setItem('pageSize', String(newLimit))
    const newParams = new URLSearchParams(searchParams)
    newParams.set('limit', String(newLimit))
    newParams.set('page', '1') // Reset to first page when changing page size
    setSearchParams(newParams)
  }

  const handleSearchChange = (newQuery) => {
    // Ensure the controlled input clears immediately before URL updates
    // This avoids rare races in tests/environments where router updates are delayed
    flushSync(() => setQuery(newQuery))
    const newParams = new URLSearchParams(searchParams)
    if (newQuery.trim()) {
      newParams.set('search', newQuery.trim())
    } else {
      newParams.delete('search')
    }
    newParams.set('page', '1') // Reset to first page when searching
    setSearchParams(newParams)
  }

  const handleStatusChange = (newStatus) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('status', newStatus)
    newParams.set('page', '1') // Reset to first page when changing filter
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

  function handleSort(column) {
    setSortConfig((prev) => {
      // Third click on same column (already desc) → reset to default sort
      if (prev.column === column && prev.direction === 'desc') {
        localStorage.removeItem('plantsListSort')
        return { column: 'sort_order', direction: 'asc' }
      }
      const newConfig = {
        column,
        direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc',
      }
      localStorage.setItem('plantsListSort', JSON.stringify(newConfig))
      return newConfig
    })
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
    if (orderedIds.length !== newList.length) {
      setSaveError('Cannot save order: some plants are missing identifiers')
      return
    }
    try {
      await plantsApi.reorder(orderedIds)
    } catch (e) {
      setSaveError(e?.message || 'Failed to save order')
    }
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
    if (!toDelete) {
      closeDialog()
      return
    }
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
      setTotal((prev) => Math.max(0, prev - 1))
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

      {error && !loading && (
        <ErrorNotice message={error} onRetry={() => window.location.reload()} />
      )}
      {saveError && !loading && <ErrorNotice message={saveError} />}

      {/* Search and status filters - always visible regardless of results or loading state */}
      {!error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            margin: '12px 0',
            flexWrap: 'wrap',
          }}
        >
          <SearchField
            value={query}
            onChange={handleSearchChange}
            placeholder="Search name, notes, location... or type a number to filter by threshold"
            ariaLabel="Search plants"
            autoFocus={false}
          />

          <div
            className="segmented-control"
            style={{
              display: 'inline-flex',
              background: '#f3f4f6',
              padding: 4,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
            }}
          >
            {[
              { id: 'active', label: 'Active' },
              { id: 'archived', label: 'Archived' },
              { id: 'all', label: 'All' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleStatusChange(opt.id)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 14,
                  fontWeight: status === opt.id ? 600 : 400,
                  background: status === opt.id ? '#ffffff' : 'transparent',
                  color: status === opt.id ? '#111827' : '#6b7280',
                  boxShadow: status === opt.id ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!error && (
        <div style={{ position: 'relative' }}>
          {loading && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                background: 'rgba(255,255,255,0.7)',
                backdropFilter: 'blur(1px)',
              }}
            >
              <Loader label="Loading plants..." />
            </div>
          )}
          <div style={loading ? { opacity: 0.4, pointerEvents: 'none' } : {}}>
            {/* Active filter indicator */}
            {searchQuery && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  margin: '0 0 12px 0',
                  background: '#f3f4f6',
                  borderRadius: 6,
                  fontSize: 14,
                  color: '#374151',
                }}
              >
                <span>
                  Filtered by: <strong>&quot;{searchQuery}&quot;</strong>
                </span>
                <button
                  onClick={() => handleSearchChange('')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 6px',
                    fontSize: 16,
                    color: '#6b7280',
                    lineHeight: 1,
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
                !loading && (
                  <EmptyState
                    title="No plants"
                    description="Get started by creating your first plant."
                  >
                    <button className="btn btn-primary" onClick={() => navigate('/plants/new')}>
                      New plant
                    </button>
                  </EmptyState>
                )
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

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={displayedPlants.map((p) => p.uuid).filter(Boolean)}
                    strategy={verticalListSortingStrategy}
                  >
                    <table className="table plants-table">
                      <thead>
                        <tr>
                          <th
                            className="th"
                            scope="col"
                            title="Current retained water percentage and quick actions"
                            style={{ minWidth: 200, cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => handleSort('care')}
                          >
                            Water min/retained{' '}
                            {sortConfig.column === 'care' &&
                              (sortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                            <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                          </th>
                          <th
                            className="th"
                            scope="col"
                            title="Plant name"
                            style={{
                              minWidth: 160,
                              width: 180,
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                            onClick={() => handleSort('name')}
                          >
                            Name{' '}
                            {sortConfig.column === 'name' &&
                              (sortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                            <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                          </th>
                          <th
                            className="th"
                            scope="col"
                            title="Notes"
                            style={{ minWidth: 160, cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => handleSort('notes')}
                          >
                            Notes{' '}
                            {sortConfig.column === 'notes' &&
                              (sortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                            <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                          </th>
                          <th
                            className="th hide-column-phone"
                            scope="col"
                            title="Watering frequency"
                            style={{ cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => handleSort('freq')}
                          >
                            Freq{' '}
                            {sortConfig.column === 'freq' &&
                              (sortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                            <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                          </th>
                          <th
                            className="th hide-column-phone"
                            scope="col"
                            title="Next planned watering date"
                            style={{ cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => handleSort('next')}
                          >
                            Next{' '}
                            {sortConfig.column === 'next' &&
                              (sortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                            <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                          </th>
                          <th
                            className="th hide-column-phone"
                            scope="col"
                            title="Location"
                            style={{ minWidth: 90, cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => handleSort('location')}
                          >
                            Location{' '}
                            {sortConfig.column === 'location' &&
                              (sortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                            <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                          </th>
                          <th
                            className="th hide-column-tablet"
                            scope="col"
                            title="Last update time"
                            style={{
                              minWidth: 100,
                              width: 100,
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                            onClick={() => handleSort('updated')}
                          >
                            Updated{' '}
                            {sortConfig.column === 'updated' &&
                              (sortConfig.direction === 'asc' ? ' ↑' : ' ↓')}
                            <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                          </th>
                          <th className="th right" scope="col" title="Row actions">
                            Actions <span style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedPlants.map((p, idx) => (
                          <SortablePlantRow
                            key={p.uuid || idx}
                            p={p}
                            idx={idx}
                            canReorder={!searchQuery && page === 1}
                            operationMode={operationMode}
                            defaultThreshold={defaultThreshold}
                            handleView={handleView}
                            handleEdit={handleEdit}
                            handleDelete={handleDelete}
                            moveUp={moveUp}
                            moveDown={moveDown}
                            displayedPlantsCount={displayedPlants.length}
                          />
                        ))}
                      </tbody>
                    </table>
                  </SortableContext>
                </DndContext>

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
          </div>
        </div>
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
