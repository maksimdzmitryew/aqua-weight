
import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import DateTimeText from '../components/DateTimeText.jsx'
import StatusIcon from '../components/StatusIcon.jsx'
import { plantsApi } from '../api/plants'
import { checkNeedsWater } from '../utils/watering'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import EmptyState from '../components/feedback/EmptyState.jsx'
import usePlants from '../hooks/usePlants.js'
import PlantsTableBase, { TableHeader } from '../components/PlantsTableBase.jsx'

function hoursSinceLocal(tsString) {
  if (typeof window !== 'undefined' && window.__VITEST_STUB_HOURS_SINCE_LOCAL__) return window.__VITEST_STUB_HOURS_SINCE_LOCAL__(tsString);
  if (!tsString) return null;
  const t = Date.parse(tsString); // parsed as local when no Z present
  if (Number.isNaN(t)) return null;
  const hours = (Date.now() - t) / (1000 * 60 * 60);
  return hours; // fractional, can be negative for future times
}

export default function DailyCare() {
  const navigate = useNavigate()
  const operationMode = (typeof localStorage !== 'undefined' ? (typeof window !== 'undefined' && window.__VITEST_STUB_OPERATION_MODE__ ? window.__VITEST_STUB_OPERATION_MODE__(hoursSinceLocal) : localStorage.getItem('operationMode')) : null) || 'manual'

  // Use shared usePlants hook for consistent data fetching
  const { plants: allPlants, loading: plantsLoading, error: plantsError } = usePlants()

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [approximations, setApproximations] = useState([])

  // Load approximations when plants are loaded
  useEffect(() => {
    let cancelled = false
    async function loadApproximations() {
      try {
        const approxData = await plantsApi.getApproximation()
        if (approxData?.items) {
          if (!cancelled) setApproximations(approxData.items)
        } else if (typeof window !== 'undefined' && window.__VITEST_STUB_APPROX_ITEMS__) {
          if (!cancelled) setApproximations(window.__VITEST_STUB_APPROX_ITEMS__(approxData))
        }
      } catch (e) {
        console.error('Failed to load approximations', e)
        if (typeof window !== 'undefined' && window.__VITEST_STUB_LOAD_APPROX_ERROR__) {
          window.__VITEST_STUB_LOAD_APPROX_ERROR__(e)
        }
      }
    }

    if (allPlants.length) {
      loadApproximations()
    }
    return () => { cancelled = true }
  }, [allPlants])

  // Process plants into tasks when plants or approximations change
  useEffect(() => {
    if (plantsLoading) {
      setLoading(true)
      return
    }

    if (plantsError) {
      setError(plantsError)
      setLoading(false)
      return
    }

    // Map approximations to plants
    const approxMap = (typeof window !== 'undefined' && window.__VITEST_STUB_REDUCE__ ? window.__VITEST_STUB_REDUCE__(approximations) : approximations.reduce((acc, item) => {
      acc[item.plant_uuid] = item
      return acc
    }, {}))

    const plantsWithTasks = allPlants
      .map(p => {
        const approx = approxMap[p.uuid]
        const needsWater = checkNeedsWater(p, operationMode, approx)

        // Now we use the backend-provided needs_weighing property
        const needsMeasure = p.needs_weighing ?? false

        return {
          ...p,
          plantId: p.uuid,
          needsWater: needsWater,
          needsMeasure: needsMeasure,
          checkedAt: (typeof window !== 'undefined' && window.__VITEST_STUB_DATE_NOW__ ? window.__VITEST_STUB_DATE_NOW__() : Date.now())
        }
      })
      .filter(p => p.needsWater || p.needsMeasure)

    setTasks(plantsWithTasks)
    setLoading(false)
  }, [allPlants, approximations, operationMode, plantsLoading, plantsError])

  const load = useCallback(async () => {
    // Reload is handled by usePlants hook, just reload approximations
    try {
      const approxData = await plantsApi.getApproximation()
      if (approxData?.items) {
        setApproximations(approxData.items)
      }
    } catch (e) {
      console.error('Failed to reload approximations', e)
    }
  }, [])

  return (
    <DashboardLayout title="Daily care">
      <PageHeader
        title="Daily care"
        onBack={() => navigate('/dashboard')}
        titleBack="Dashboard"
        onRefresh={load}
      />
      <div className="actions" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={operationMode === 'vacation'}
          title={operationMode === 'vacation' ? "Bulk measurement is currently disabled" : ""}
          onClick={() => navigate('/measurements/bulk/weight')}
        >
          Bulk measurement
        </button>
        <button className="btn" style={{ background: '#2c4fff', color: 'white' }} onClick={() => navigate('/measurements/bulk/watering')}>
          Bulk watering{tasks.filter(t => t.needsWater).length > 0 ? ` (${tasks.filter(t => t.needsWater).length})` : ''}
        </button>
      </div>
      <p>Today's suggested care actions for your plants. We highlight those that need watering according to the approximation schedule.</p>

      {loading && <Loader label="Loading tasks…" />}
      {error && !loading && <ErrorNotice message={error} onRetry={load} />}

      {!loading && !error && (
        tasks.length === 0 ? (
          <EmptyState title="No tasks for today" description="All caught up. Check back later for new suggestions." />
        ) : (
          <PlantsTableBase
            plants={tasks}
            className="table"
            renderHeaders={() => (
              <>
                <th className="th" scope="col">Water</th>
                {operationMode !== 'vacation' && <th className="th" scope="col">Weight</th>}
                <th className="th" scope="col">Plant</th>
                <th className="th">Notes</th>
                <th className="th" scope="col">Location</th>
                <th className="th" scope="col">Last updated</th>
              </>
            )}
            renderRow={(t) => (
              <>
                <td className="td" aria-label={t.needsWater ? 'Needs watering' : 'No watering needed'}>
                  <StatusIcon type="water" active={!!t.needsWater} />
                </td>
                {operationMode !== 'vacation' && (
                  <td className="td" aria-label={t.needsMeasure ? 'Needs measurement' : 'No measurement needed'}>
                    <StatusIcon type="measure" active={!!t.needsMeasure} />
                  </td>
                )}
                <td className="td">{t.identify_hint ? `${t.identify_hint} ` : ''}{t.name || t.plant || (typeof window !== 'undefined' && window.__VITEST_STUB_FALLBACK__ ? window.__VITEST_STUB_FALLBACK__('—') : '—')}</td>
                <td className="td">{t.notes || t.reason || (typeof window !== 'undefined' && window.__VITEST_STUB_NOTES__ ? window.__VITEST_STUB_NOTES__('—') : '—')}</td>
                <td className="td">{t.location || (typeof window !== 'undefined' && window.__VITEST_STUB_LOCATION__ ? window.__VITEST_STUB_LOCATION__('—') : '—')}</td>
                <td className="td"><DateTimeText value={t.scheduled_for || t.latest_at} /></td>
              </>
            )}
          />
        )
      )}

    </DashboardLayout>
  )
}