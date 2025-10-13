import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'

export default function Settings() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  const [name, setName] = useState(() => localStorage.getItem('displayName') || '')
  const [dtFormat, setDtFormat] = useState(() => localStorage.getItem('dtFormat') || 'europe')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setSaved(''), 1500)
    return () => clearTimeout(t)
  }, [saved])

  function save(e) {
    e.preventDefault()
    localStorage.setItem('theme', theme)
    localStorage.setItem('displayName', name)
    localStorage.setItem('dtFormat', dtFormat)
    setSaved('Saved!')
  }

  return (
    <DashboardLayout title="Settings">
      <h1 style={{ marginTop: 0 }}>Settings</h1>
      <p>Update your local preferences. These settings are stored in your browser only.</p>

      <form onSubmit={save} style={{ maxWidth: 520 }}>
        <div style={fieldRow}>
          <label style={label}>Display name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={input}
          />
        </div>
        <div style={fieldRow}>
          <label style={label}>Theme</label>
          <select value={theme} onChange={(e) => setTheme(e.target.value)} style={input}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
        <div style={fieldRow}>
          <label style={label}>Date/Time format</label>
          <select value={dtFormat} onChange={(e) => setDtFormat(e.target.value)} style={input}>
            <option value="europe">Europe (DD/MM/YYYY 24h)</option>
            <option value="usa">USA (MM/DD/YYYY 12h)</option>
          </select>
        </div>
        <div style={{ marginTop: 16 }}>
          <button type="submit" style={button}>Save</button>
          {saved && <span style={{ marginLeft: 12, color: 'seagreen' }}>{saved}</span>}
        </div>
      </form>
    </DashboardLayout>
  )
}

const fieldRow = { display: 'flex', flexDirection: 'column', marginBottom: 12 }
const label = { fontWeight: 600, marginBottom: 6 }
const input = { padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6 }
const button = { padding: '8px 12px', background: '#111827', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }
