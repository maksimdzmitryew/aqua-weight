import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { formatDateTime } from '../utils/datetime.js'
import { dailyApi } from '../api/daily'

export default function DailyCare() {
  const navigate = useNavigate()

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await dailyApi.list()
      const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
      setTasks(list)
    } catch (e) {
      setError(e?.message || 'Failed to load today\'s tasks')
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
        titleBack="Dashboard"
        onRefresh={load}
      />
      <button className="btn btn-primary" onClick={() => navigate('/measurements/bulk/weight')}>Start Bulk Measurement</button>
      <p>Today's suggested care actions for your plants.</p>

      {loading && <div>Loading…</div>}
      {error && !loading && <div className="text-danger">{error}</div>}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                  <th className="th">Location</th>
                  <th className="th">Plant</th>
                  <th className="th">Task</th>
                  <th className="th">When</th>
                <th className="th">Notes</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => (
                <tr key={t.id ?? t.uuid ?? i}>
                    <td className="td">{t.location || '—'}</td>
                    <td className="td">{t.name || t.plant || '—'}</td>
                    <td className="td">{t.task || t.type || t.action || t.water_loss_total_pct + ' watering' || '—'}</td>
                    <td className="td">{formatDateTime(t.scheduled_for || t.due_at || t.created_at || t.updated_at) || '—'}</td>
                  <td className="td">{t.notes || t.reason || '—'}</td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td className="td" colSpan={4}>No tasks for today</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

    </DashboardLayout>
  )
}