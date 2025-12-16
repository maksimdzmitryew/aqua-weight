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
})
