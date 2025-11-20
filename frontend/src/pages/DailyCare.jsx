import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
import { dailyApi } from '../api/daily'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import EmptyState from '../components/feedback/EmptyState.jsx'

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
      <div className="actions" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => navigate('/measurements/bulk/weight')}>Bulk Measurement</button>
        <button className="btn" onClick={() => navigate('/measurements/bulk/watering')}>Bulk watering</button>
      </div>
      <p>Today's suggested care actions for your plants.</p>

      {loading && <Loader label="Loading tasks…" />}
      {error && !loading && <ErrorNotice message={error} onRetry={load} />}

      {!loading && !error && (
        tasks.length === 0 ? (
          <EmptyState title="No tasks for today" description="All caught up. Check back later for new suggestions." />
        ) : (
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
                      <td className="td"><DateTimeText value={t.scheduled_for || t.due_at || t.created_at || t.updated_at} /></td>
                    <td className="td">{t.notes || t.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

    </DashboardLayout>
  )
}