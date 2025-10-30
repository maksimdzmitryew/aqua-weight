import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { useTheme } from '../ThemeContext.jsx'
import { formatDateTime } from '../utils/datetime.js'

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
      <PageHeader
        title="Daily care"
        onBack={() => navigate('/dashboard')}
        onRefresh={load}
        isDark={isDark}
      />

      <p>Today's suggested care actions for your plants.</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div style={{ color: 'crimson' }}>{error}</div>}

      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                  <th style={th}>Location</th>
                  <th style={th}>Plant</th>
                  <th style={th}>Task</th>
                  <th style={th}>When</th>
                <th style={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => (
                <tr key={t.id ?? t.uuid ?? i}>
                    <td style={td}>{t.location || '—'}</td>
                    <td style={td}>{t.name || t.plant || '—'}</td>
                    <td style={td}>{t.task || t.type || t.action || t.water_loss_total_pct + ' watering' || '—'}</td>
                    <td style={td}>{formatDateTime(t.scheduled_for || t.due_at || t.created_at || t.updated_at) || '—'}</td>
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