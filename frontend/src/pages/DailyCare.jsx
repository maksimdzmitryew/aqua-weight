
import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
import { plantsApi } from '../api/plants'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import EmptyState from '../components/feedback/EmptyState.jsx'

function hoursSinceLocal(tsString) {
  if (!tsString) return null;
  const t = Date.parse(tsString); // parsed as local when no Z present
  if (Number.isNaN(t)) return null;
  const hours = (Date.now() - t) / (1000 * 60 * 60);
  return hours; // fractional, can be negative for future times
}

export default function DailyCare() {
  const navigate = useNavigate()

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // First get all plants to filter by water retained percentage
      const plantsData = await plantsApi.list()
      const allPlants = Array.isArray(plantsData) ? plantsData : []


        const filteredPlants = allPlants.map(plantReview => {
          const id = plantReview.id;
          const needsMeasure = id != null && (hoursSinceLocal(plantReview.latest_at)) > 18;
          const needsWater = id != null && (plantReview.water_retained_pct ?? -Infinity) < 30;
          let task_plant = {}

            task_plant = {
                ...plantReview,
                plantId: id,
                needsMeasure: needsMeasure,
                needsWater: needsWater,
                checkedAt: Date.now()
            };

          // return a new object, copy original fields and add/override
          return task_plant;

        });

      const plantsWithTasks = filteredPlants.filter(
          plantReview => (plantReview.needsMeasure || plantReview.needsWater)
      )

      setTasks(plantsWithTasks)

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
        <button className="btn btn-primary" onClick={() => navigate('/measurements/bulk/weight')}>
            Bulk Measurement {tasks.filter(t => t.needsMeasure).length > 0 ? ` (${tasks.filter(t => t.needsMeasure).length})` : ''}
        </button>
        <button className="btn"  style={{ background: '#2c4fff', color: 'white'}} onClick={() => navigate('/measurements/bulk/watering')}>
            Bulk watering{tasks.filter(t => t.needsWater).length > 0 ? ` (${tasks.filter(t => t.needsWater).length})` : ''}
        </button>
      </div>
      <p>Today's suggested care actions for your plants that need watering (retained &lt; 30%).</p>

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
                    <th className="th">Measure</th>
                    <th className="th">Water</th>
                    <th className="th">Last updated</th>
                  <th className="th">Notes</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => (
                  <tr key={t.id ?? t.uuid ?? i}>
                      <td className="td">{t.location || '—'}</td>
                      <td className="td">{t.name || t.plant || '—'}</td>
                      <td className="td">{t.needsMeasure ? '+' : '—'}</td>
                      <td className="td">{t.needsWater ? '+' : '—'}</td>
                      <td className="td"><DateTimeText value={t.scheduled_for || t.latest_at} /></td>
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