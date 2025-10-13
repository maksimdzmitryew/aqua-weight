import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { formatDateTime } from '../utils/datetime.js'
import { useTheme } from '../ThemeContext.jsx'
import IconButton from '../components/IconButton.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useLocation as useRouterLocation, useNavigate } from 'react-router-dom'

export default function LocationsList() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'
  const navigate = useNavigate()
  const routerLocation = useRouterLocation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const th = {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: isDark ? '1px solid #374151' : '1px solid #e5e7eb',
    background: isDark ? '#111827' : '#f9fafb',
    color: isDark ? '#e5e7eb' : '#111827',
    fontWeight: 600,
  }

  const td = {
    padding: '8px 10px',
    borderBottom: isDark ? '1px solid #1f2937' : '1px solid #f3f4f6',
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/locations')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setLocations(data)
      } catch (e) {
        if (!cancelled) setError('Failed to load locations')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
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
      const res = await fetch('/api/locations/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordered_ids: orderedIds }),
      })
      if (!res.ok) {
        let detail = ''
        try { const data = await res.json(); detail = data?.detail || '' } catch (_) { try { detail = await res.text() } catch (_) { detail = '' } }
        setSaveError(detail || `Failed to save order (HTTP ${res.status})`)
      }
    } catch (e) {
      setSaveError(e.message || 'Failed to save order')
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

  const handleStyle = {
    cursor: 'grab',
    color: isDark ? '#9ca3af' : '#6b7280',
    paddingRight: 6,
    userSelect: 'none',
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
      const res = await fetch(`/api/locations/${uuid}`, { method: 'DELETE' })
      if (!res.ok) {
        let detail = ''
        try { const data = await res.json(); detail = data?.detail || '' } catch (_) { try { detail = await res.text() } catch (_) { detail = '' } }
        setSaveError(detail || `Failed to delete (HTTP ${res.status})`)
      } else {
        setLocations((prev) => prev.filter((it) => it.id !== toDelete.id))
      }
    } catch (e) {
      setSaveError(e.message || 'Failed to delete location')
    } finally {
      closeDialog()
    }
  }

  return (
    <DashboardLayout title="Locations">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Locations</h1>
        <button
          type="button"
          onClick={() => navigate('/locations/new')}
          style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', background: isDark ? '#1f2937' : '#111827', color: 'white' }}
        >
          + Create
        </button>
      </div>
      <p>List of all available locations fetched from the API.</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}
      {saveError && !loading && <div style={{ color: 'crimson' }}>{saveError}</div>}

      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}></th>
                <th style={th}>Name</th>
                <th style={th}>Description</th>
                <th style={th}>Created</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
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
                  <td style={{ ...td, width: 24 }}>
                    <span style={handleStyle} title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>
                  </td>
                  <td style={td}>{l.name}</td>
                  <td style={td}>{l.description || '—'}</td>
                  <td style={td}>{formatDateTime(l.created_at)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <IconButton icon="view" label={`View location ${l.name}`} onClick={() => handleView(l)} variant="ghost" />
                    <IconButton icon="edit" label={`Edit location ${l.name}`} onClick={() => handleEdit(l)} variant="subtle" />
                    <IconButton icon="delete" label={`Delete location ${l.name}`} onClick={() => handleDelete(l)} variant="danger" />
                  </td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr>
                  <td style={td} colSpan={5}>No locations found</td>
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

