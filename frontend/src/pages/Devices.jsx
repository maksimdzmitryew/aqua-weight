import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { apiClient } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import Badge from '../components/Badge.jsx'

export default function Devices() {
  const { deviceId: currentDeviceId } = useAuth()
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [untrusting, setUntrusting] = useState(null) // Stores device_id to be untrusted

  useEffect(() => {
    fetchDevices()
  }, [])

  async function fetchDevices() {
    try {
      setLoading(true)
      const data = await apiClient.get('/auth/devices')
      setDevices(data.devices || [])
      setError(null)
    } catch (err) {
      setError(err.detail || 'Failed to fetch devices')
    } finally {
      setLoading(false)
    }
  }

  async function handleUntrust() {
    if (!untrusting) return
    try {
      await apiClient.post(`/auth/devices/${untrusting}/untrust`)
      // If we untrusted the current device, the backend will revoke our session.
      // The apiClient or AuthContext should handle the 401 and redirect to login.
      // For other devices, we just refresh the list.
      if (untrusting === currentDeviceId) {
        // Wait for redirection or force it?
        // Usually, the next request will fail.
      }
      await fetchDevices()
    } catch (err) {
      setError(err.detail || 'Failed to untrust device')
    } finally {
      setUntrusting(null)
    }
  }

  return (
    <DashboardLayout title="Your Devices">
      <div style={{ maxWidth: 800 }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ marginTop: 0 }}>Your Devices</h1>
          <p style={{ color: '#6b7280' }}>
            These are the devices that have accessed your account. You can revoke trust from any
            device to log it out.
          </p>
        </header>

        {error && <ErrorNotice message={error} style={{ marginBottom: 20 }} />}

        {loading ? (
          <p>Loading devices...</p>
        ) : (
          <div className="devices-list">
            {devices.map((device) => {
              const isCurrent = device.device_id === currentDeviceId
              return (
                <div
                  key={device.device_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    marginBottom: '12px',
                    background: isCurrent ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                    borderColor: isCurrent ? '#3b82f6' : '#e5e7eb',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px',
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '1.1em' }}>
                        {device.device_name || 'Unknown Device'}
                      </span>
                      {isCurrent && <Badge>Current Device</Badge>}
                      {device.trusted && <Badge tone="success">Trusted</Badge>}
                    </div>
                    <div style={{ fontSize: '0.9em', color: '#6b7280', marginBottom: '4px' }}>
                      Last active: <DateTimeText value={device.last_login_at} />
                    </div>
                    <div style={{ fontSize: '0.8em', color: '#9ca3af', fontStyle: 'italic' }}>
                      {device.user_agent}
                    </div>
                  </div>
                  <div>
                    {device.trusted && (
                      <button
                        type="button"
                        onClick={() => setUntrusting(device.device_id)}
                        className="btn btn-danger"
                        style={{
                          padding: '6px 12px',
                          fontSize: '0.85em',
                        }}
                      >
                        Untrust
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!untrusting}
        title="Untrust Device?"
        message="This will revoke this device's trust and log it out from all active sessions. You will need to use MFA to log in from this device again."
        onConfirm={handleUntrust}
        onCancel={() => setUntrusting(null)}
        confirmText="Untrust Device"
        tone="danger"
      />
    </DashboardLayout>
  )
}
