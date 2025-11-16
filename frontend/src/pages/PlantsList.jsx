import React, { useEffect, useState } from 'react'
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
import '../styles/plants-list.css'

export default function PlantsList() {
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const navigate = useNavigate()
  const routerLocation = useRouterLocation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await plantsApi.list(controller.signal)
        setPlants(Array.isArray(data) ? data : [])
      } catch (e) {
        // Ignore abort errors (e.g., React StrictMode double-invokes effects in dev)
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
  }, [])

  useEffect(() => {
    const updated = routerLocation.state && routerLocation.state.updatedPlant
    if (updated) {
      setPlants((prev) => prev.map((it) => (it.uuid === updated.uuid ? updated : it)))
      // clear navigation state to avoid reapplying on refresh/back
      try {
      // Replace current entry and clear transient state the React Router way
        navigate(routerLocation.pathname, { replace: true, state: null })
      } catch {}
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

  function getWaterLossCellStyle(waterRemainingPct) {
    if (waterRemainingPct < 0) {
      return {
        background: 'black',
        color: 'white',
      }
    } else if (waterRemainingPct < 20) {
      return {
        background: '#dc2626',
        color: 'white',
      }
    } else if (waterRemainingPct < 40) {
      return {
        background: '#fecaca',
      }
    } else if (waterRemainingPct < 70) {
      return {
        background: '#fef3c7',
      }
    } else if (waterRemainingPct < 90) {
      return {
        background: '#bbf7d0',
      }
    } else {
      return {
        color: 'green',
      }
    }
  }

  function closeDialog() {
    setConfirmOpen(false)
    setToDelete(null)
  }

  async function confirmDelete() {
    if (!toDelete) { closeDialog(); return }
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
            <table className="table plants-table">
              <thead>
                <tr>
                  <th className="th" scope="col">Care, Water remain</th>
                  <th className="th" scope="col">Name</th>
                  <th className="th" scope="col">Description</th>
                  <th className="th" scope="col">Location</th>
                  <th className="th hide-column" scope="col">Updated</th>
                  <th className="th right" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plants.map((p, idx) => (
                  <tr key={p.uuid || idx}
                      draggable
                      onDragStart={() => onDragStart(idx)}
                      onDragEnd={onDragEnd}
                      onDragOver={(e) => onDragOver(e, idx)}
                  >
                    <td className="td" style={getWaterLossCellStyle(p.water_retained_pct)} title={p.uuid ? 'View plant' : undefined}>
                      <span style={{ display: 'inline-flex', gap: '10px' }}>
                        <QuickCreateButtons plantUuid={p.uuid} plantName={p.name} compact={true}/>
                        {p.water_retained_pct}%
                      </span>
                    </td>
                    <td className="td" title={p.uuid ? 'View plant' : undefined}>
                        {p.uuid ? (
                        <Link to={`/plants/${p.uuid}`} state={{ plant: p }} className="block-link">
                            {p.name}
                        </Link>
                      ) : (
                        p.name
                      )}
                    </td>
                    <td className="td" title={p.uuid ? 'View plant' : undefined}>
                      {p.uuid ? (
                        <Link to={`/plants/${p.uuid}`} state={{ plant: p }} className="block-link">
                            {p.description || '—'}
                        </Link>
                      ) : (
                        p.description || '—'
                      )}
                    </td>
                    <td className="td" style={{ width: 90 }}>{p.location || '—'}</td>
                    <td className="td hide-column" style={{ width: 130 }}><DateTimeText value={p.created_at} /></td>
                    <td className="td text-right nowrap">
                      <IconButton icon="view" label={`View plant ${p.name}`} onClick={() => handleView(p)} variant="ghost" />
                      <IconButton icon="edit" label={`Edit plant ${p.name}`} onClick={() => handleEdit(p)} variant="subtle" />
                      <IconButton icon="delete" label={`Delete plant ${p.name}`} onClick={() => handleDelete(p)} variant="danger" />
                      <button
                        type="button"
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                        aria-label={`Move ${p.name} up`}
                        title="Move up"
                        style={{ padding: '2px 6px', marginRight: 4, borderRadius: 4 }}
                      >↑</button>
                      <button
                        type="button"
                        onClick={() => moveDown(idx)}
                        disabled={idx === plants.length - 1}
                        aria-label={`Move ${p.name} down`}
                        title="Move down"
                        style={{ padding: '2px 6px', borderRadius: 4 }}
                      >↓</button>
                      <span
                        className="drag-handle"
                        title="Drag to reorder"
                        aria-label="Drag to reorder"
                        style={{ marginLeft: 8 }}
                      >⋮⋮</span>
                    </td>
                  </tr>
                ))}
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