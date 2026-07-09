import React, { useState, useEffect } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { apiClient } from '../api/client.js'
import { removeHelper } from '../utils/whatsapp_helpers.js'

export default function WhatsappHelpers() {
  const [helpers, setHelpers] = useState([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [savingState, setSavingState] = useState({ action: null, disabled: false })

  useEffect(() => {
    loadHelpers()
  }, [])

  async function loadHelpers() {
    try {
      const data = await apiClient.get('/whatsapp/helping-users')
      setHelpers(data || [])
    } catch {
      // Fallback to localStorage via addHelper/removeHelper
    }
  }

  function clearStatus() {
    setSavingState({ action: null, disabled: false })
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSavingState({ action: 'add', disabled: true })
    try {
      await apiClient.post('/whatsapp/helping-users', {
        name: name.trim(),
        phone: phone.trim() || null,
      })
      setSavingState({ action: 'add_saved', disabled: true })
      setName('')
      setPhone('')
      setTimeout(clearStatus, 2000)
    } catch {
      setSavingState({ action: 'add_failed', disabled: true })
      setTimeout(clearStatus, 3000)
    }
  }

  async function handleDelete(id) {
    setSavingState({ action: 'delete', disabled: true })
    try {
      await apiClient.delete(`/whatsapp/helping-users/${id}`)
      removeHelper(id)
      setSavingState({ action: 'delete_saved', disabled: true })
      setTimeout(clearStatus, 2000)
    } catch {
      setSavingState({ action: 'delete_failed', disabled: true })
      setTimeout(clearStatus, 3000)
    }
  }

  async function handleRequestDigest() {
    setSavingState({ action: 'digest', disabled: true })
    try {
      await apiClient.post('/whatsapp/trigger-digest')
      setSavingState({ action: 'digest_saved', disabled: true })
      setTimeout(clearStatus, 3000)
    } catch {
      setSavingState({ action: 'digest_failed', disabled: true })
      setTimeout(clearStatus, 4000)
    }
  }

  const getButtonText = () => {
    if (savingState.action === 'add') return 'Saving...'
    if (savingState.action === 'add_saved') return 'Saved!'
    if (savingState.action === 'add_failed') return 'Failed'
    return 'Add Helper'
  }

  const getDeleteButtonText = () => {
    if (savingState.action === 'delete') return 'Deleting...'
    if (savingState.action === 'delete_saved') return 'Deleted!'
    if (savingState.action === 'delete_failed') return 'Failed'
    return 'Delete'
  }

  const getDigestButtonText = () => {
    if (savingState.action === 'digest') return 'Requesting...'
    if (savingState.action === 'digest_saved') return 'Done!'
    if (savingState.action === 'digest_failed') return 'Failed'
    return 'Request Thirsty Plants Now'
  }

  const getButtonColor = (action) => {
    if (action?.endsWith('_failed')) return { backgroundColor: '#ef4444', color: 'white' }
    if (action?.endsWith('_saved')) return { backgroundColor: '#10b981', color: 'white' }
    return undefined
  }

  return (
    <DashboardLayout title="WhatsApp Helpers">
      <h1 style={{ marginTop: 0 }}>WhatsApp Helpers</h1>
      <p>Manage users who can request thirsty plants lists during vacation mode.</p>

      <form onSubmit={handleAdd} style={{ maxWidth: 400, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Helper name"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6 }}
          />
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6 }}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={savingState.disabled && savingState.action?.startsWith('add')}
          style={getButtonColor(savingState.action)}
        >
          {getButtonText()}
        </button>
      </form>

      {helpers.length === 0 ? (
        <p>No helpers configured yet.</p>
      ) : (
        <div style={{ maxWidth: 600 }}>
          {helpers.map((h) => (
            <div
              key={h.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              <div>
                <strong>{h.name}</strong>
                {h.phone && <span style={{ marginLeft: 8, color: '#6b7280' }}>{h.phone}</span>}
              </div>
              <button
                onClick={() => handleDelete(h.id)}
                className="btn btn-danger btn-sm"
                disabled={savingState.disabled && savingState.action?.startsWith('delete')}
                style={getButtonColor(savingState.action)}
              >
                {getDeleteButtonText()}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <button
          onClick={handleRequestDigest}
          className="btn btn-secondary"
          disabled={savingState.disabled && savingState.action?.startsWith('digest')}
          style={getButtonColor(savingState.action)}
        >
          {getDigestButtonText()}
        </button>
      </div>
    </DashboardLayout>
  )
}
