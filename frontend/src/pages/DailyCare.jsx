import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useTheme } from '../ThemeContext.jsx'

export default function DailyCare() {
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/daily')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // Accept either an array or an object with a `items` array
      const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
      setTasks(list)
    } catch (e) {
      setError('Failed to load today\'s tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await load()
      } catch {}
    })()
    return () => { cancelled = true }
  }, [load])

  return (
    <DashboardLayout title="Daily care">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Daily care</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', cursor: 'pointer', background: isDark ? '#0b0f16' : '#fff', color: isDark ? '#e5e7eb' : '#111827' }}
          >
            ← Dashboard
          </button>
          <button
            type="button"
            onClick={load}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', background: isDark ? '#1f2937' : '#111827', color: 'white' }}
          >
            Refresh
          </button>
        </div>
      </div>

      <p>Today’s suggested care actions for your plants.</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}


      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Plant</th>
                <th style={th}>Task</th>
                <th style={th}>When</th>
                <th style={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => (
                <tr key={t.id ?? t.uuid ?? i}>
                  <td style={td}>{t.plant_name || t.plant || '—'}</td>
                  <td style={td}>{t.task || t.type || t.action || '—'}</td>
                  <td style={td}>{t.when || t.due_at || t.scheduled_for || 'Today'}</td>
                  <td style={td}>{t.notes || t.reason || '—'}</td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td style={td} colSpan={4}>No tasks for today</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  )
}