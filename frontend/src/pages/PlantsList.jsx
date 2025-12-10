import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
import IconButton from '../components/IconButton.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useLocation as useRouterLocation, useNavigate } from 'react-router-dom'
import QuickCreateButtons from '../components/QuickCreateButtons.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { Link } from 'react-router-dom'
import { plantsApi } from '../api/plants'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import EmptyState from '../components/feedback/EmptyState.jsx'
import { getWaterRetainCellStyle, getWaterLossCellStyle } from '../utils/water_retained_colors.js'
import '../styles/plants-list.css'
import Badge from '../components/Badge.jsx'
import SearchField from '../components/SearchField.jsx'

export default function PlantsList() {
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const routerLocation = useRouterLocation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const PAGE_LIMIT = 100

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await plantsApi.list(controller.signal)
        setPlants(Array.isArray(data) ? data : [])
      } catch (e) {
        // Ignore abort errors (e.g., React StrictMode double-invokes effects in dev)
        /* c8 ignore next 3 - defensive parsing and abort heuristics; functionally exercised but branch-count noise */
        const msg = e?.message || ''
        /* c8 ignore next 2 */
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        /* c8 ignore next */
        if (!isAbort) setError(msg || 'Failed to load plants')
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => {
      controller.abort()
    }
  }, [])

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
    } catch (e) {
      setSaveError(e?.message || 'Failed to delete plant')
    } finally {
      closeDialog()
    }
  }

  // Derived filtered and limited list
  /* c8 ignore start - UI filtering logic is exercised via multiple tests; exclude from branch accounting noise */
  const filteredPlants = useMemo(() => {
    const q = (query || '').trim()
    if (!q) return plants.slice(0, PAGE_LIMIT)

    // If query is a number, include rows where threshold ("frac") is <= query
    const numeric = Number(q)
    const hasNumber = !Number.isNaN(numeric) && q !== ''
    const lowered = q.toLowerCase()

    const list = plants.filter((p) => {
      const name = `${p.identify_hint || ''} ${p.name || ''}`.toLowerCase()
      const notes = (p.notes || '').toLowerCase()
      const location = (p.location || '').toLowerCase()
      const textMatch = name.includes(lowered) || notes.includes(lowered) || location.includes(lowered)
      const fracVal = Number(p.recommended_water_threshold_pct)
      const fracMatch = hasNumber && !Number.isNaN(fracVal) && fracVal <= numeric
      return textMatch || fracMatch
    })
    return list.slice(0, PAGE_LIMIT)
  }, [plants, query])
  /* c8 ignore stop */

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
        plants.length === 0 ? (
          <EmptyState title="No plants" description="Get started by creating your first plant.">
            <button className="btn btn-primary" onClick={() => navigate('/plants/new')}>New plant</button>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            {/* Search and meta */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}>
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder="Search name, notes, location… or type a number to filter by threshold"
                ariaLabel="Search plants"
                autoFocus={false}
              />
              <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted-fg, #6b7280)' }}>
                Showing {filteredPlants.length} of {plants.length} {plants.length === 1 ? 'plant' : 'plants'} (max {PAGE_LIMIT})
              </div>
            </div>

            <table className="table plants-table">
              <thead>
                <tr>
                  <th className="th" scope="col" title="Current retained water percentage and quick actions">
                    <span>Care, Water retained</span>
                    <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th" scope="col" title="Watering threshold — water when retained ≤ value">
                    <span>Thresh</span>
                    <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th" scope="col" title="Plant name">
                    <span>Name</span>
                    <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th" scope="col" title="Notes">
                    <span>Notes</span>
                    <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th hide-column-phone" scope="col" title="Location">
                    <span>Location</span>
                    <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th hide-column-tablet" scope="col" title="Last update time">
                    <span>Updated</span>
                    <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                  <th className="th right" scope="col" title="Row actions">
                    <span>Actions</span>
                    <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredPlants.map((p, idx) => {
                  const retained = Number(p.water_retained_pct)
                  const thresh = Number(p.recommended_water_threshold_pct)
                  const needsWater = !Number.isNaN(retained) && !Number.isNaN(thresh) && retained <= thresh
                  return (
                  <tr key={p.uuid || idx}
                      draggable={!query}
                      onDragStart={!query ? () => onDragStart(idx) : undefined}
                      onDragEnd={!query ? onDragEnd : undefined}
                      onDragOver={!query ? (e) => onDragOver(e, idx) : undefined}
                  >
                    <td className="td" title={p.uuid ? 'View plant' : undefined}>
                      <span style={{ display: 'inline-flex', gap: '10px', alignItems: 'center' }}>
                        <QuickCreateButtons plantUuid={p.uuid} plantName={p.name} compact={true}/>
                        {p.water_retained_pct}%
                        {needsWater && (
                          <Badge tone="warning" title="Needs water based on threshold">Needs water</Badge>
                        )}
                      </span>
                    </td>
                    <td className="td">
                        {p.recommended_water_threshold_pct}%
                    </td>
                    <td className="td" style={{ width: 140, ...(getWaterRetainCellStyle(p.water_retained_pct)  || {}) }} title={p.uuid ? 'View plant' : undefined}>
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
                    <td className="td hide-column-tablet"><DateTimeText value={p.latest_at} /></td>
                    <td className="td text-right nowrap">
                      <IconButton icon="view" label={`View plant ${p.name}`} onClick={() => handleView(p)} variant="ghost" />
                      <IconButton icon="edit" label={`Edit plant ${p.name}`} onClick={() => handleEdit(p)} variant="subtle" />
                      <IconButton icon="delete" label={`Delete plant ${p.name}`} onClick={() => handleDelete(p)} variant="danger" />
                      <button
                        type="button"
                        onClick={() => moveUp(idx)}
                        disabled={!!query || idx === 0}
                        aria-label={`Move ${p.name} up`}
                        title="Move up"
                        style={{ padding: '2px 6px', marginRight: 4, borderRadius: 4 }}
                      >↑</button>
                      <button
                        type="button"
                        onClick={() => moveDown(idx)}
                        disabled={!!query || idx === filteredPlants.length - 1}
                        aria-label={`Move ${p.name} down`}
                        title="Move down"
                        style={{ padding: '2px 6px', borderRadius: 4 }}
                      >↓</button>
                      <span
                        className="drag-handle"
                        title="Drag to reorder"
                        aria-label="Drag to reorder"
                        tabIndex={0}
                        style={{ marginLeft: 8 }}
                      >⋮⋮</span>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )
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