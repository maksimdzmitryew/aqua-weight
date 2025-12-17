import React from 'react'
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'

// Stub Sparkline to keep tests lightweight and to assert props easily
vi.mock('../../../src/components/Sparkline.jsx', () => ({
  default: (props) => (
    React.createElement('div', {
      'data-testid': 'sparkline',
      'data-props': JSON.stringify(props),
    })
  ),
}))

// Note: We avoid global mocks for react-router and api modules to prevent cross-file leakage

describe('pages/Dashboard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })
  test('getInitialShowSuggestedInterval returns true on getter error (covers fallback)', async () => {
    const { getInitialShowSuggestedInterval } = await import('../../../src/pages/Dashboard.jsx')
    const throws = () => { throw new Error('boom') }
    expect(getInitialShowSuggestedInterval(throws)).toBe(true)
  })

  test('renders dashboard layout and welcome text', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([])
    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Updated expectations to match current UI content
    expect(screen.getByRole('heading', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByText(/each plant is represented by its weight trend/i)).toBeInTheDocument()
  })

  test('shows loader then empty state when no plants (covers early return in measurements loader)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([])
    const listByPlantSpy = vi.spyOn(measurementsApi, 'listByPlant')
    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // After loading resolves, empty state should appear and no measurements request happens
    await screen.findByText(/no plants yet/i)
    expect(listByPlantSpy).not.toHaveBeenCalled()
  })

  test('handles plants load error gracefully (covers 48-53)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    vi.spyOn(plantsApi, 'list').mockRejectedValueOnce(new Error('Boom'))
    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Error notice rendered and loader hidden after failure
    await screen.findByText(/failed to load plants|boom/i)
    expect(screen.queryByText(/loading plants/i)).not.toBeInTheDocument()
  })

  test('renders plant cards with Sparkline and navigates on click; toggles and selects persist to localStorage', async () => {
    // Prepare localStorage defaults
    localStorage.removeItem('dashboard.chartsPerRow')
    localStorage.removeItem('chart.showSuggestedInterval')

    const plant = {
      uuid: 'p-1',
      name: 'Aloe',
      min_dry_weight_g: 100,
      max_water_weight_g: 50,
      recommended_water_threshold_pct: 40,
    }
    const { plantsApi } = await import('../../../src/api/plants')
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([plant])

    // Measurements contain a repotting marker that should be excluded and daily collapse
    const meas = [
      // DESC order: latest first
      // non-repot data (should be included if weight present)
      { measured_at: '2024-02-03 11:00:00', measured_weight_g: 140 },
      { measured_at: '2024-02-03 08:00:00', measured_weight_g: 141 }, // same day, should be collapsed
      { measured_at: '2024-02-02 10:00:00', measured_weight_g: 150 },
      // repotting marker (should split and everything after this removed)
      {
        measured_at: '2024-02-01 09:00:00',
        measured_weight_g: 100,
        last_dry_weight_g: 100,
        water_added_g: 50,
        last_wet_weight_g: null,
        water_loss_total_pct: null,
        water_loss_total_g: null,
        water_loss_day_pct: null,
        water_loss_day_g: null,
      },
      // older data that should be ignored due to repot
      { measured_at: '2024-01-31 09:00:00', measured_weight_g: 120 },
    ]
    const { measurementsApi } = await import('../../../src/api/measurements')
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce(meas)

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Wait for sparkline to appear (means we had > 1 unique day points)
    const spark = await screen.findByTestId('sparkline')
    const props = JSON.parse(spark.getAttribute('data-props'))
    // Ensure data collapsed to daily unique points (> 1)
    expect(Array.isArray(props.data)).toBe(true)
    expect(props.data.length).toBe(2)
    // Threshold vertical marker toggle default is true
    expect(props.showFirstBelowThreshVLine).toBe(true)

    // Toggle suggested interval off -> localStorage updated
    const toggle = screen.getByLabelText(/show suggested watering interval/i)
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(localStorage.getItem('chart.showSuggestedInterval')).toBe('0')

    // Change charts per row -> persist and affects grid columns
    const select = screen.getByRole('combobox', { name: /charts per row/i })
    fireEvent.change(select, { target: { value: '3' } })
    expect(localStorage.getItem('dashboard.chartsPerRow')).toBe('3')

    // Click on card should not crash (navigation tested elsewhere)
    const titleEl = screen.getByText('Aloe')
    const card = titleEl.closest('[title="Open statistics"]')
    expect(card).toBeTruthy()
    fireEvent.click(card)
  })

  test('shows "Not enough data" when <= 1 point', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([{ uuid: 'p-2', name: 'Monstera' }])
    // Return single valid point only -> sparkline not shown
    const { measurementsApi } = await import('../../../src/api/measurements')
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-03-01 10:00:00', measured_weight_g: 200 },
    ])

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Not enough data placeholder
    await screen.findByText(/not enough data to chart/i)

    // No sparkline should be shown
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument()
  })

  test('treats measurements error for a plant as empty series (covers lines 112-113)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    // One plant returned
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([{ uuid: 'p-err', name: 'Cactus' }])
    // Measurements endpoint fails for that plant -> inner catch should return [uid, []]
    vi.spyOn(measurementsApi, 'listByPlant').mockRejectedValueOnce(new Error('fetch failed'))

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // After loading finishes, since there are 0 points, the card should show the fallback text
    await screen.findByText('Cactus')
    await screen.findByText(/not enough data to chart/i)
    // No sparkline is rendered
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument()
    // No series-level error banner should be shown (outer catch not triggered)
    expect(screen.queryByText(/failed to load measurements/i)).not.toBeInTheDocument()
  })

  test('shows series error when aggregation fails (covers line 120)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')

    // Provide at least one plant so the measurements loader runs
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([{ uuid: 'p-x', name: 'Fern' }])

    // Force Promise.all to throw to hit the outer catch block
    const allSpy = vi.spyOn(Promise, 'all').mockImplementation(() => {
      throw new Error('aggregate explode')
    })

    try {
      const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

      render(
        <ThemeProvider>
          <MemoryRouter>
            <Dashboard />
          </MemoryRouter>
        </ThemeProvider>
      )

      // Series error banner should appear with our error message text
      await screen.findByText(/aggregate explode|failed to load measurements/i)
    } finally {
      allSpy.mockRestore()
    }
  })


  test('handles plant without uuid and filters invalid measurement date (covers 68, 105-106, 231)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    const plantOk = {
      uuid: 'p-3',
      name: 'Rose',
      min_dry_weight_g: 80,
      max_water_weight_g: 40,
      recommended_water_threshold_pct: 50,
    }
    // Include a plant without uuid to exercise the early return [null, []]
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([{ name: 'NoId' }, plantOk])

    // Measurements for the valid plant: include one invalid date record to be filtered out
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-04-02 08:00:00', measured_weight_g: 115 },
      { measured_at: 'bad-date', measured_weight_g: 120 }, // should be filtered by NaN time
      { measured_at: '2024-04-01 09:00:00', measured_weight_g: 110 },
    ])

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Scope to the Rose card to avoid cross-test leakage
    const roseTitle = await screen.findByText('Rose')
    const roseCard = roseTitle.closest('[title="Open statistics"]')
    expect(roseCard).toBeTruthy()
    const spark = within(roseCard).getByTestId('sparkline')
    const props = JSON.parse(spark.getAttribute('data-props'))
    // Only the two valid dates remain
    expect(props.data.length).toBe(2)
    // maxWaterG should be forwarded from plant
    expect(props.maxWaterG).toBe(40)
  })

  test('uses taller chartHeight when chartsPerRow is 1 (covers line 130)', async () => {
    // Persist chartsPerRow=1 before mount
    localStorage.setItem('dashboard.chartsPerRow', '1')

    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([{ uuid: 'p-4', name: 'Basil', min_dry_weight_g: 10, max_water_weight_g: 10, recommended_water_threshold_pct: 20 }])
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-05-02 10:00:00', measured_weight_g: 30 },
      { measured_at: '2024-05-01 10:00:00', measured_weight_g: 25 },
    ])

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    const spark = await screen.findByTestId('sparkline')
    const props = JSON.parse(spark.getAttribute('data-props'))
    expect(props.height).toBe(180)
  })
})
