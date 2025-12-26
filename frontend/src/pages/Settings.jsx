import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'

export default function Settings() {
  const { theme, effectiveTheme, setTheme } = useTheme()
  const [name, setName] = useState(() => localStorage.getItem('displayName') || '')
  const [dtFormat, setDtFormat] = useState(() => localStorage.getItem('dtFormat') || 'europe')
  const [vacationMode, setVacationMode] = useState(() => localStorage.getItem('vacationMode') || 'disabled')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setSaved(''), 1500)
    return () => clearTimeout(t)
  }, [saved])

  function save(e) {
    e.preventDefault()
    // Theme is persisted by ThemeProvider on change; only persist other fields here
    localStorage.setItem('displayName', name)
    localStorage.setItem('dtFormat', dtFormat)
    localStorage.setItem('vacationMode', vacationMode)
    setSaved('Saved!')
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

  return (
    <DashboardLayout title="Settings">
      <h1 style={{ marginTop: 0 }}>Settings</h1>
      <p>Update your local preferences. These settings are stored in your browser only.</p>

      <form onSubmit={save} style={{ maxWidth: 520 }}>
        <div style={fieldRow}>
          <label style={label} htmlFor="display_name">Display name</label>
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
          <label style={label} htmlFor="theme">Theme</label>
          <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)} style={styles.input}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
        <div style={fieldRow}>
          <label style={label} htmlFor="dt_format">Date/Time format</label>
          <select id="dt_format" value={dtFormat} onChange={(e) => setDtFormat(e.target.value)} style={styles.input}>
            <option value="europe">Europe (DD/MM/YYYY 24h)</option>
            <option value="usa">USA (MM/DD/YYYY 12h)</option>
          </select>
        </div>
        <div style={fieldRow}>
          <label style={label} htmlFor="vacation_mode">Vacation mode</label>
          <select
            id="vacation_mode"
            value={vacationMode}
            onChange={(e) => setVacationMode(e.target.value)}
            style={styles.input}
          >
            <option value="disabled">Disabled</option>
            <option value="enabled">Enabled</option>
          </select>
        </div>
        <div style={{ marginTop: 16 }}>
          <button type="submit" style={styles.button}>Save</button>
          {saved && <span style={{ marginLeft: 12, color: 'seagreen' }}>{saved}</span>}
        </div>
      </form>
    </DashboardLayout>
  )
}

const fieldRow = { display: 'flex', flexDirection: 'column', marginBottom: 12 }
const label = { fontWeight: 600, marginBottom: 6 }
