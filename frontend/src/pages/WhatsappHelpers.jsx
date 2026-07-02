import React, { useState, useEffect } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { apiClient } from '../api/client.js'
import { getHelpers, addHelper, updateHelper, removeHelper } from '../utils/whatsapp_helpers.js'

export default function WhatsappHelpers() {
  const [helpers, setHelpers] = useState([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    loadHelpers()
  }, [])

  async function loadHelpers() {
    try {
      const data = await apiClient.get('/whatsapp/helping-users')
      setHelpers(data || [])
    } catch {
      // Fallback to localStorage
      setHelpers(getHelpers())
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      const result = await apiClient.post('/whatsapp/helping-users', { name: name.trim(), phone: phone.trim() || null })
      addHelper({ name: result.name, phone: result.phone, id: result.id })
      setHelpers((prev) => [...prev, result])
      setName('')
      setPhone('')
      setSaved('Helper added!')
      setTimeout(() => setSaved(''), 2000)
    } catch (err) {
      setError(err.detail || 'Failed to add helper')
    }
  }

  async function handleDelete(id) {
    try {
      await apiClient.delete(`/whatsapp/helping-users/${id}`)
      removeHelper(id)
      setHelpers((prev) => prev.filter((h) => h.id !== id))
    } catch (err) {
      setError(err.detail || 'Failed to delete helper')
    }
  }

  async function handleRequestDigest() {
    try {
      const result = await apiClient.post('/whatsapp/trigger-digest')
      setSaved(`Thirsty plants: ${result.thirsty_plants?.length || 0}`)
      setTimeout(() => setSaved(''), 3000)
    } catch (err) {
      setError(err.detail || 'Failed to get thirsty plants')
    }
  }

  return (
    <DashboardLayout title="WhatsApp Helpers">
      <h1 style={{ marginTop: 0 }}>WhatsApp Helpers</h1>
      <p>Manage users who can request thirsty plants lists during vacation mode.</p>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {saved && <p style={{ color: 'seagreen' }}>{saved}</p>}

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
        <button type="submit" className="btn btn-primary">Add Helper</button>
      </form>

      {helpers.length === 0 ? (
        <p>No helpers configured yet.</p>
      ) : (
        <div style={{ maxWidth: 600 }}>
          {helpers.map((h) => (
            <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
              <div>
                <strong>{h.name}</strong>
                {h.phone && <span style={{ marginLeft: 8, color: '#6b7280' }}>{h.phone}</span>}
              </div>
              <button onClick={() => handleDelete(h.id)} className="btn btn-danger btn-sm">Delete</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <button onClick={handleRequestDigest} className="btn btn-secondary">
          Request Thirsty Plants Now
        </button>
      </div>
    </DashboardLayout>
  )
}
