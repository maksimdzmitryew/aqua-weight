import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import SudoMode from '../components/auth/SudoMode.jsx'
import { apiClient } from '../api/client.js'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { Link } from 'react-router-dom'

export default function Settings() {
  const { theme, effectiveTheme, setTheme } = useTheme()
  const { settings, loading, updateSettings } = useSettings()

  const [name, setName] = useState('')
  const [dtFormat, setDtFormat] = useState('europe')
  const [operationMode, setOperationMode] = useState('manual')
  const [defaultThreshold, setDefaultThreshold] = useState('40')
  const [pageSize, setPageSize] = useState('20')

  const [thresholdError, setThresholdError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    if (settings) {
      setName(settings.displayName || '')
      setDtFormat(settings.dtFormat || 'europe')
      setOperationMode(settings.operationMode || 'manual')
      setDefaultThreshold(settings.defaultThreshold || '40')
      setPageSize(settings.pageSize || '20')
    }
  }, [settings])

  const [showSudo, setShowSudo] = useState(false)
  const [newCodes, setNewCodes] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setSaved(''), 1500)
    return () => clearTimeout(t)
  }, [saved])

  function normalizeThreshold(value) {
    if (value === '') {
      return { value, error: 'Default threshold is required.' }
    }
    const parsed = Number(value)
    if (Number.isNaN(parsed)) {
      return { value, error: 'Default threshold must be a number.' }
    }
    if (parsed < 0 || parsed > 100) {
      return { value, error: 'Default threshold must be between 0 and 100.' }
    }
    return { value: String(parsed), error: '' }
  }

  async function save(e) {
    e.preventDefault()
    const { value: normalizedThreshold, error } = normalizeThreshold(defaultThreshold)
    if (error) {
      setThresholdError(error)
      return
    }
    setThresholdError('')

    try {
      await updateSettings({
        displayName: name,
        dtFormat,
        operationMode,
        defaultThreshold: normalizedThreshold,
        pageSize,
        theme, // include theme in sync
      })
      setSaved('Saved!')
    } catch (err) {
      setError(err.detail || 'Failed to save settings')
    }
  }

  async function handleRegenerate(password) {
    setError('')
    setShowSudo(false)
    try {
      const data = await apiClient.post('/auth/recovery-codes/regenerate', { password })
      setNewCodes(data.recovery_codes)
    } catch (err) {
      setError(err.detail || 'Failed to regenerate recovery codes')
    }
  }

  const styles = useMemo(() => {
    const isDark = effectiveTheme === 'dark'
    return {
      input: {
        padding: '8px 10px',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        background: isDark ? '#111827' : '#ffffff',
        color: isDark ? '#f9fafb' : '#111827',
      },
      button: {
        padding: '8px 12px',
        background: isDark ? '#111827' : '#111827',
        color: 'white',
        border: 0,
        borderRadius: 6,
        cursor: 'pointer',
      },
    }
  }, [effectiveTheme])

  if (loading) {
    return (
      <DashboardLayout title="Settings">
        <p>Loading...</p>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout title="Settings">
      <h1 style={{ marginTop: 0 }}>Settings</h1>
      <p>Update your preferences. These settings are synced to your account.</p>

      <form onSubmit={save} style={{ maxWidth: 520 }}>
        <div style={fieldRow}>
          <label style={label} htmlFor="display_name">
            Display name
          </label>
          <input
            id="display_name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={styles.input}
          />
        </div>
        <div style={fieldRow}>
          <label style={label} htmlFor="theme">
            Theme
          </label>
          <select
            id="theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            style={styles.input}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
        <div style={fieldRow}>
          <label style={label} htmlFor="dt_format">
            Date/Time format
          </label>
          <select
            id="dt_format"
            value={dtFormat}
            onChange={(e) => setDtFormat(e.target.value)}
            style={styles.input}
          >
            <option value="europe">Europe (DD/MM/YYYY 24h)</option>
            <option value="usa">USA (MM/DD/YYYY 12h)</option>
          </select>
        </div>
        <div style={fieldRow}>
          <label style={label} htmlFor="page_size">
            Items per page
          </label>
          <select
            id="page_size"
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value)}
            style={styles.input}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <div style={fieldRow}>
          <label style={label} htmlFor="operation_mode">
            Operation mode
          </label>
          <select
            id="operation_mode"
            value={operationMode}
            onChange={(e) => setOperationMode(e.target.value)}
            style={styles.input}
          >
            <option value="automatic">Automatic</option>
            <option value="manual">Manual</option>
            <option value="vacation">Vacation</option>
          </select>
        </div>
        <div style={fieldRow}>
          <label style={label} htmlFor="default_threshold">
            Default Watering Threshold (%)
          </label>
          <input
            id="default_threshold"
            type="number"
            min="0"
            max="100"
            value={defaultThreshold}
            onChange={(e) => {
              const { value, error } = normalizeThreshold(e.target.value)
              setDefaultThreshold(value)
              setThresholdError(error)
            }}
            style={styles.input}
          />
          {thresholdError && (
            <span style={{ marginTop: 6, color: 'crimson', fontSize: '0.9em' }}>
              {thresholdError}
            </span>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <button type="submit" style={styles.button}>
            Save
          </button>
          {saved && <span style={{ marginLeft: 12, color: 'seagreen' }}>{saved}</span>}
        </div>
      </form>

      {/* Security Section */}
      <h2 style={{ marginTop: 32 }}>Security</h2>
      <div
        style={{
          padding: 16,
          border: '1px solid #ef4444',
          borderRadius: 8,
          background: effectiveTheme === 'dark' ? '#111827' : '#fef2f2',
          maxWidth: 520,
        }}
      >
        <h3 style={{ marginTop: 0, color: '#ef4444' }}>Regenerate Recovery Codes</h3>
        <p style={{ fontSize: '0.9em', marginBottom: 16 }}>
          Generating new recovery codes will invalidate all of your current codes and log you out
          fromm all other devices except for the current one. You can only do this once every 24
          hours.
        </p>
        <button
          type="button"
          onClick={() => {
            setError('')
            setShowSudo(true)
          }}
          style={{ ...styles.button, background: '#ef4444' }}
        >
          Regenerate Codes
        </button>
        {error && <div style={{ color: '#ef4444', fontSize: '0.9em', marginTop: 12 }}>{error}</div>}

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #ef4444' }}>
          <h3 style={{ marginTop: 0, color: '#ef4444' }}>Device Management</h3>
          <p style={{ fontSize: '0.9em', marginBottom: 12 }}>
            View and manage devices that have access to your account.
          </p>
          <Link
            to="/devices"
            style={{
              ...styles.button,
              display: 'inline-block',
              textDecoration: 'none',
              textAlign: 'center',
            }}
          >
            Manage Devices
          </Link>
        </div>
      </div>

      <SudoMode
        open={showSudo}
        onConfirm={handleRegenerate}
        onCancel={() => setShowSudo(false)}
        message="Enter your password to regenerate your TOTP recovery codes."
      />

      <ConfirmDialog
        open={!!newCodes}
        title="New Recovery Codes"
        onCancel={() => setNewCodes(null)}
        buttons={[
          {
            key: 'close',
            text: 'I have saved these codes',
            onClick: () => setNewCodes(null),
            style: styles.button,
          },
        ]}
        icon="success"
        message={
          <div style={{ textAlign: 'left', marginTop: 16 }}>
            <p style={{ fontWeight: 600, color: '#ef4444', marginBottom: 12 }}>
              WARNING: These codes will only be shown once. Please save them in a secure location.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                fontFamily: 'monospace',
                background: effectiveTheme === 'dark' ? '#000' : '#f3f4f6',
                padding: 12,
                borderRadius: 6,
              }}
            >
              {newCodes?.map((code) => (
                <div key={code}>{code}</div>
              ))}
            </div>
          </div>
        }
      />
    </DashboardLayout>
  )
}

const fieldRow = { display: 'flex', flexDirection: 'column', marginBottom: 12 }
const label = { fontWeight: 600, marginBottom: 6 }
