import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { formatDateTime } from '../utils/datetime.js'
import IconButton from '../components/IconButton.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useLocation as useRouterLocation, useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader.jsx'
import { locationsApi } from '../api/locations'

export default function LocationsList() {
  const [locations, setLocations] = useState([])
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
        const data = await locationsApi.list(controller.signal)
        setLocations(Array.isArray(data) ? data : [])
      } catch (e) {
        // Ignore abort errors (e.g., React StrictMode double-invokes effects in dev)
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (!isAbort) setError(msg || 'Failed to load locations')
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
    const updated = routerLocation.state && routerLocation.state.updatedLocation
    if (updated) {
      setLocations((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
      try {
        window.history.replaceState({}, document.title, routerLocation.pathname)
      } catch {}
    }
  }, [routerLocation.state, routerLocation.pathname])

  function handleView(l) {
    const details = `Location #${l.id}\nName: ${l.name}\nDescription: ${l.description || '—'}\nCreated: ${formatDateTime(l.created_at)}`
    window.alert(details)
  }

  function handleEdit(l) {
    navigate(`/locations/${l.id}/edit`, { state: { location: l } })
  }

  function handleDelete(l) {
    setToDelete(l)
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
    const orderedIds = newList.map((l) => l.uuid).filter(Boolean)
    if (orderedIds.length !== newList.length) return // cannot persist without uuids
    try {
      await locationsApi.reorder(orderedIds)
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
    setLocations((prev) => reorder(prev, dragIndex, index))
    setDragIndex(index)
  }

  function onDragEnd() {
    if (dragIndex === null) return
    persistOrder(locations)
    setDragIndex(null)
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
        setSaveError('Cannot delete this location: missing identifier')
        return
      }
      await locationsApi.remove(uuid)
      setLocations((prev) => prev.filter((it) => it.id !== toDelete.id))
    } catch (e) {
      setSaveError(e?.message || 'Failed to delete location')
    } finally {
      closeDialog()
    }
  }

  return (
    <DashboardLayout title="Locations">
      <PageHeader
        title="Locations"
        onBack={() => navigate('/dashboard')}
        titleBack="Dashboard"
        onCreate={() => navigate('/locations/new')}
      />

      <p>List of all available locations fetched from the API.</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div className="text-danger">{error}</div>}
      {saveError && !loading && <div className="text-danger">{saveError}</div>}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="th"></th>
                <th className="th">Name</th>
                <th className="th">Description</th>
                <th className="th">Created</th>
                <th className="th right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l, idx) => (
                <tr key={l.id}
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => onDragOver(e, idx)}
                    onDragEnd={onDragEnd}
                >
                  <td className="td" style={{ width: 24 }}>
                    <span className="drag-handle" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>
                  </td>
                  <td className="td">{l.name}</td>
                  <td className="td">{l.description || '—'}</td>
                  <td className="td">{formatDateTime(l.created_at)}</td>
                  <td className="td text-right nowrap">
                    <IconButton icon="view" label={`View location ${l.name}`} onClick={() => handleView(l)} variant="ghost" />
                    <IconButton icon="edit" label={`Edit location ${l.name}`} onClick={() => handleEdit(l)} variant="subtle" />
                    <IconButton icon="delete" label={`Delete location ${l.name}`} onClick={() => handleDelete(l)} variant="danger" />
                  </td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr>
                  <td className="td" colSpan={5}>No locations found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={toDelete ? `Delete ${toDelete.name}?` : 'Delete?'}
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

