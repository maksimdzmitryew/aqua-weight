import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Stub Sparkline to capture props passed by PlantStats
vi.mock('../../../src/components/Sparkline.jsx', () => ({
  default: (props) => React.createElement('div', {
    'data-testid': 'sparkline',
    'data-props': JSON.stringify(props),
  }),
}))

// Mock navigate to prevent real navigation
const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  }
})

// Mock APIs used by PlantStats
vi.mock('../../../src/api/plants', () => ({
  plantsApi: {
    getByUuid: vi.fn(),
  },
}))
vi.mock('../../../src/api/measurements', () => ({
  measurementsApi: {
    listByPlant: vi.fn(),
  },
}))

function renderAt(path, element) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/stats/:uuid" element={element} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/PlantStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset localStorage defaults
    localStorage.clear()
  })

  test('uses plant from router state (no fetch) and renders Sparkline with refLines and default suggested interval flag', async () => {
    const plant = {
      uuid: 'p-1', name: 'Aloe',
      min_dry_weight_g: 100,
      max_water_weight_g: 50,
      recommended_water_threshold_pct: 40,
    }
    const { measurementsApi } = await import('../../../src/api/measurements')
    // two different days (desc order newest first)
    const meas = [
      { measured_weight_g: 160, measured_at: '2025-01-03 10:00:00' },
      { measured_weight_g: 155, measured_at: '2025-01-03 09:00:00' }, // same day collapsed
      { measured_weight_g: 158, measured_at: '2025-01-02 08:00:00' },
      // repot signature should be excluded along with anything older than it
      { measured_weight_g: 120, last_dry_weight_g: 100, water_added_g: 50 },
      { measured_weight_g: 150, measured_at: '2025-01-01 08:00:00' }, // excluded due to repot above
    ]
    measurementsApi.listByPlant.mockResolvedValueOnce(meas)

    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')

    renderAt({ pathname: '/stats/p-1', state: { plant } }, <PlantStats />)

    // Loader for measurements then Sparkline appears
    await waitFor(() => expect(screen.queryByText(/Loading measurements/i)).not.toBeInTheDocument())
    const spark = await screen.findByTestId('sparkline')
    const props = JSON.parse(spark.getAttribute('data-props') || '{}')

    // points should include unique days after repot, chronological asc, so 2025-01-02 then 2025-01-03
    expect(Array.isArray(props.data)).toBe(true)
    expect(props.data.length).toBe(2)
    // refLines include Dry, Max, Thresh
    expect(props.refLines?.map(r => r.label)).toEqual(['Dry', 'Max', 'Thresh'])
    // default suggested interval flag equals true
    expect(props.showFirstBelowThreshVLine).toBe(true)
    // maxWaterG propagated from plant
    expect(props.maxWaterG).toBe(50)
  })

  test('shows "Not enough data to chart" when <= 1 point', async () => {
    const plant = { uuid: 'p-2', name: 'Monstera', min_dry_weight_g: 200, max_water_weight_g: 40, recommended_water_threshold_pct: 30 }
    const { measurementsApi } = await import('../../../src/api/measurements')
    // Single valid point
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 220, measured_at: '2025-02-01 09:00:00' },
    ])

    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-2', state: { plant } }, <PlantStats />)

    await screen.findByText(/Not enough data to chart/i)
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument()
  })

  test('loads plant by uuid when state missing and handles error', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')
    plantsApi.getByUuid.mockRejectedValueOnce(new Error('Boom'))
    // measurements still called (effect runs) but uuid exists; we can keep it simple
    measurementsApi.listByPlant.mockResolvedValueOnce([])

    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt('/stats/missing', <PlantStats />)

    // Shows error notice and hides loader
    await screen.findByText(/failed to load plant|boom/i)
    expect(screen.queryByText(/Loading plant/i)).not.toBeInTheDocument()
  })

  test('shows measurements load error in dedicated area', async () => {
    const plant = { uuid: 'p-3', name: 'Cactus' }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockRejectedValueOnce(new Error('MFail'))

    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-3', state: { plant } }, <PlantStats />)

    await screen.findByText(/mfail|failed to load measurements/i)
  })

  test('loads plant by uuid successfully and renders Sparkline with title using plant name', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')
    const plant = {
      uuid: 'ok-1', name: 'ZZ Plant', min_dry_weight_g: 90, max_water_weight_g: 30, recommended_water_threshold_pct: 50,
    }
    plantsApi.getByUuid.mockResolvedValueOnce(plant)
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 100, measured_at: '2025-03-10 10:00:00' },
      { measured_weight_g: 110, measured_at: '2025-03-11 10:00:00' },
    ])

    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt('/stats/ok-1', <PlantStats />)

    // Heading uses plant name and sparkline renders
    await screen.findByRole('heading', { name: /zz plant/i })
    const spark = await screen.findByTestId('sparkline')
    const props = JSON.parse(spark.getAttribute('data-props') || '{}')
    expect(props.data?.length).toBe(2)
    expect(props.refLines?.length).toBeGreaterThan(0)
  })

  test('respects localStorage chart.showSuggestedInterval flag = 0', async () => {
    localStorage.setItem('chart.showSuggestedInterval', '0')
    const plant = {
      uuid: 'p-4', name: 'Ficus', min_dry_weight_g: 100, max_water_weight_g: 50, recommended_water_threshold_pct: 25,
    }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 140, measured_at: '2025-01-01 10:00:00' },
      { measured_weight_g: 130, measured_at: '2025-01-02 10:00:00' },
    ])

    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-4', state: { plant } }, <PlantStats />)

    const spark = await screen.findByTestId('sparkline')
    const props = JSON.parse(spark.getAttribute('data-props') || '{}')
    expect(props.showFirstBelowThreshVLine).toBe(false)
  })

  test('falls back to showSuggestedInterval=true when localStorage.getItem throws (covers try/catch init)', async () => {
    const getSpy = vi.spyOn(window.localStorage, 'getItem').mockImplementation((key) => {
      if (key === 'chart.showSuggestedInterval') throw new Error('boom')
      return null
    })
    const plant = {
      uuid: 'p-5', name: 'Fern', min_dry_weight_g: 100, max_water_weight_g: 50, recommended_water_threshold_pct: 40,
    }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 150, measured_at: '2025-04-01 08:00:00' },
      { measured_weight_g: 145, measured_at: '2025-04-02 08:00:00' },
    ])

    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-5', state: { plant } }, <PlantStats />)

    const spark = await screen.findByTestId('sparkline')
    const props = JSON.parse(spark.getAttribute('data-props') || '{}')
    expect(props.showFirstBelowThreshVLine).toBe(true)
    getSpy.mockRestore()
  })

  test('does not call measurementsApi when uuid is missing (early return)', async () => {
    const rrd = await import('react-router-dom')
    const useParamsSpy = vi.spyOn(rrd, 'useParams').mockReturnValue({})
    const { measurementsApi } = await import('../../../src/api/measurements')
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    // Render with any router path; useParams is mocked to return no uuid
    renderAt('/stats/anything', <PlantStats />)
    // Let effects tick
    await waitFor(() => true)
    expect(measurementsApi.listByPlant).not.toHaveBeenCalled()
    useParamsSpy.mockRestore()
  })

  test('treats non-array measurements response as empty and shows fallback', async () => {
    const plant = { uuid: 'p-6', name: 'Ivy', min_dry_weight_g: 50, max_water_weight_g: 20, recommended_water_threshold_pct: 30 }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockResolvedValueOnce(null)
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-6', state: { plant } }, <PlantStats />)
    await screen.findByText(/Not enough data to chart/i)
  })

  test('filters out invalid measurements (no date or invalid weight), keeping only valid points', async () => {
    const plant = { uuid: 'p-7', name: 'Palm', min_dry_weight_g: 80, max_water_weight_g: 40, recommended_water_threshold_pct: 20 }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 120, measured_at: '2025-05-01 10:00:00' },
      { measured_weight_g: 118 }, // no date -> skipped (covers dayKey falsy at line 78)
      { measured_weight_g: 119, measured_at: '2025-05-02 12:00:00' }, // valid for the day, should be kept
      { measured_weight_g: 'NaN', measured_at: '2025-05-02 10:00:00' }, // later same day but invalid -> filtered at 86-87
    ])
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-7', state: { plant } }, <PlantStats />)
    const spark = await screen.findByTestId('sparkline')
    const props = JSON.parse(spark.getAttribute('data-props') || '{}')
    // Unique valid days: 2025-05-01 and 2025-05-02 -> 2 points
    expect(props.data?.length).toBe(2)
  })

  test('AbortError during plant fetch is ignored (no error displayed)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')
    plantsApi.getByUuid.mockRejectedValueOnce({ name: 'AbortError', message: 'aborted' })
    measurementsApi.listByPlant.mockResolvedValueOnce([])
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt('/stats/ab-1', <PlantStats />)
    // ensure loading stops and no error message is shown for plant
    await waitFor(() => expect(screen.queryByText(/Loading plant/i)).not.toBeInTheDocument())
    expect(screen.queryByText(/failed to load plant|aborted/i)).not.toBeInTheDocument()
  })

  test('refLines handling when values are missing or non-finite', async () => {
    // Only max_water_weight_g provided -> refLines empty, maxWaterG set, no Thresh
    const plantA = { uuid: 'r-1', name: 'TestA', max_water_weight_g: 25 }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 100, measured_at: '2025-06-01 10:00:00' },
      { measured_weight_g: 110, measured_at: '2025-06-02 10:00:00' },
    ])
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/r-1', state: { plant: plantA } }, <PlantStats />)
    let props = JSON.parse((await screen.findByTestId('sparkline')).getAttribute('data-props') || '{}')
    expect(props.refLines?.length ?? 0).toBe(0)
    expect(props.maxWaterG).toBe(25)

    // Now min_dry + max_water with out-of-range threshold -> clamped and Thresh present
    const plantB = { uuid: 'r-2', name: 'TestB', min_dry_weight_g: 100, max_water_weight_g: 50, recommended_water_threshold_pct: 200 }
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 140, measured_at: '2025-06-01 10:00:00' },
      { measured_weight_g: 130, measured_at: '2025-06-02 10:00:00' },
    ])
    renderAt({ pathname: '/stats/r-2', state: { plant: plantB } }, <PlantStats />)
    await waitFor(async () => {
      const all = await screen.findAllByTestId('sparkline')
      const last = all[all.length - 1]
      const props = JSON.parse(last.getAttribute('data-props') || '{}')
      const labels = props.refLines?.map(r => r.label)
      expect(labels).toEqual(['Dry', 'Max', 'Thresh'])
    })
  })

  test('uses generic measurements error message when error.message is empty', async () => {
    const plant = { uuid: 'p-8', name: 'Agave' }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockRejectedValueOnce({})
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-8', state: { plant } }, <PlantStats />)
    await screen.findByText(/Failed to load measurements/i)
  })

  test('maxWaterG is null and only Dry refLine when max_water_weight_g is non-finite', async () => {
    const plant = { uuid: 'p-9', name: 'Pothos', min_dry_weight_g: 77, max_water_weight_g: 'n/a', recommended_water_threshold_pct: 25 }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 100, measured_at: '2025-07-01 10:00:00' },
      { measured_weight_g: 105, measured_at: '2025-07-02 10:00:00' },
    ])
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-9', state: { plant } }, <PlantStats />)
    const spark = await screen.findByTestId('sparkline')
    const props = JSON.parse(spark.getAttribute('data-props') || '{}')
    expect(props.maxWaterG).toBe(null)
    expect(props.refLines?.map(r => r.label)).toEqual(['Dry'])
  })

  test('Abort error recognized by message content (no error shown to user)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')
    plantsApi.getByUuid.mockRejectedValueOnce(new Error('Request aborted by user'))
    measurementsApi.listByPlant.mockResolvedValueOnce([])
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt('/stats/ab-2', <PlantStats />)
    await waitFor(() => expect(screen.queryByText(/Loading plant/i)).not.toBeInTheDocument())
    expect(screen.queryByText(/failed to load plant|aborted/i)).not.toBeInTheDocument()
  })

  test('invalid measured_at produces NaN time and is filtered out', async () => {
    const plant = { uuid: 'p-10', name: 'Snake' }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 200, measured_at: '2025-08-01 09:00:00' },
      { measured_weight_g: 210, measured_at: 'bad-date' }, // included in perDay but filtered in mapping
    ])
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-10', state: { plant } }, <PlantStats />)
    await screen.findByText(/Not enough data to chart/i)
  })

  test('plant load error with empty message shows generic error (covers msg/!isAbort branch)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')
    plantsApi.getByUuid.mockRejectedValueOnce({})
    measurementsApi.listByPlant.mockResolvedValueOnce([])
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt('/stats/generic-err', <PlantStats />)
    await screen.findByText(/Failed to load plant/i)
  })

  test('invalid weight as first reading of the day is filtered leaving insufficient data', async () => {
    const plant = { uuid: 'p-11', name: 'Bamboo' }
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockResolvedValueOnce([
      { measured_weight_g: 'NaN', measured_at: '2025-09-03 08:00:00' }, // chosen for the day
      { measured_weight_g: 180, measured_at: '2025-09-04 08:00:00' }, // another day valid
    ])
    const { default: PlantStats } = await import('../../../src/pages/PlantStats.jsx')
    renderAt({ pathname: '/stats/p-11', state: { plant } }, <PlantStats />)
    await screen.findByText(/Not enough data to chart/i)
  })
})
