import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { formatDateTime } from '../utils/datetime.js'
import { useTheme } from '../ThemeContext.jsx'
import IconButton from '../components/IconButton.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useLocation as useRouterLocation, useNavigate } from 'react-router-dom'

export default function PlantsList() {
  const [plants, setPlants] = useState([])
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
        const res = await fetch('/api/plants')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setPlants(data)
      } catch (e) {
        if (!cancelled) setError('Failed to load plants')
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
    const updated = routerLocation.state && routerLocation.state.updatedPlant
    if (updated) {
      setPlants((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
      // clear navigation state to avoid reapplying on refresh/back
      try {
        window.history.replaceState({}, document.title, routerLocation.pathname)
      } catch {}
    }
  }, [routerLocation.state, routerLocation.pathname])

  function handleView(p) {
    if (!p?.uuid) return
    navigate(`/plants/${p.uuid}`, { state: { plant: p } })
  }

  function handleEdit(p) {
    navigate(`/plants/${p.id}/edit`, { state: { plant: p } })
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
      const res = await fetch('/api/plants/order', {
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
    setPlants((prev) => reorder(prev, dragIndex, index))
    setDragIndex(index)
  }

  function onDragEnd() {
    if (dragIndex === null) return
    persistOrder(plants)
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
        setSaveError('Cannot delete this plant: missing identifier')
        return
      }
      const res = await fetch(`/api/plants/${uuid}`, { method: 'DELETE' })
      if (!res.ok) {
        let detail = ''
        try { const data = await res.json(); detail = data?.detail || '' } catch (_) { try { detail = await res.text() } catch (_) { detail = '' } }
        setSaveError(detail || `Failed to delete (HTTP ${res.status})`)
      } else {
        setPlants((prev) => prev.filter((it) => it.id !== toDelete.id))
      }
    } catch (e) {
      setSaveError(e.message || 'Failed to delete plant')
    } finally {
      closeDialog()
    }
  }

  return (
    <DashboardLayout title="Plants">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Plants</h1>
        <button
          type="button"
          onClick={() => navigate('/plants/new')}
          style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', background: isDark ? '#1f2937' : '#111827', color: 'white' }}
        >
          + Create
        </button>
      </div>
      <p>List of all available plants fetched from the API.</p>

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
                <th style={th}>Location</th>
                <th style={th}>Created</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plants.map((p, idx) => (
                <tr key={p.id}
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => onDragOver(e, idx)}
                    onDragEnd={onDragEnd}
                >
                  <td style={{ ...td, width: 24 }}>
                    <span style={handleStyle} title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>
                  </td>
                  <td style={{ ...td, cursor: p.uuid ? 'pointer' : 'default' }} onClick={() => p.uuid && handleView(p)} title={p.uuid ? 'View plant' : undefined}>
                    {p.name}
                  </td>
                  <td style={{ ...td, cursor: p.uuid ? 'pointer' : 'default' }} onClick={() => p.uuid && handleView(p)} title={p.uuid ? 'View plant' : undefined}>
                    {p.description || '—'}
                  </td>
                  <td style={td}>{p.location || '—'}</td>
                  <td style={td}>{formatDateTime(p.created_at)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <IconButton icon="beaker" label={`Measurement for ${p.name}`} onClick={() => navigate(`/measurement/new?plant=${p.uuid}`)} variant="primary" />
                    <IconButton icon="droplet" label={`Watering for ${p.name}`} onClick={() => navigate(`/measurement/watering?plant=${p.uuid}`)} variant="primary" />
                    <IconButton icon="box" label={`Repotting for ${p.name}`} onClick={() => navigate(`/measurement/repotting?plant=${p.uuid}`)} variant="primary" />
                    <IconButton icon="view" label={`View plant ${p.name}`} onClick={() => handleView(p)} variant="ghost" />
                    <IconButton icon="edit" label={`Edit plant ${p.name}`} onClick={() => handleEdit(p)} variant="subtle" />
                    <IconButton icon="delete" label={`Delete plant ${p.name}`} onClick={() => handleDelete(p)} variant="danger" />
                  </td>
                </tr>
              ))}
              {plants.length === 0 && (
                <tr>
                  <td style={td} colSpan={6}>No plants found</td>
                </tr>
              )}
            </tbody>
          </table>
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

