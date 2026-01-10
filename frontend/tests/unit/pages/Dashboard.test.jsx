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
    // Wait for the async loading to finish (empty state) to avoid act warnings
    await screen.findByText(/no plants yet/i)
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

  // --- Additional focused tests to finish branch/function coverage for Dashboard.jsx ---


  test('plants loader AbortError is ignored (covers 72-73 abort branch)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    vi.spyOn(plantsApi, 'list').mockRejectedValueOnce({ name: 'AbortError', message: 'aborted' })
    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )
    // Should show empty state (no error banner) after effect settles
    await screen.findByText(/no plants yet/i)
    expect(screen.queryByText(/failed to load plants/i)).not.toBeInTheDocument()
  })

  test('plants loader non-abort with empty message uses default text (covers 72-73 default)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    vi.spyOn(plantsApi, 'list').mockRejectedValueOnce({ message: '' })
    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )
    const alert = await screen.findByRole('alert')
    expect((alert.textContent || '').toLowerCase()).toMatch(/failed to load plants/)
  })

  test('toggling suggested interval on writes "1" (covers ternary branch at 204)', async () => {
    // Start with persisted off state
    localStorage.setItem('chart.showSuggestedInterval', '0')
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
    const toggle = screen.getByLabelText(/show suggested watering interval/i)
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).toBeChecked()
    expect(localStorage.getItem('chart.showSuggestedInterval')).toBe('1')

    // Wait for async background work to settle
    await screen.findByText(/no plants yet/i)
  })

  test('filters out entries with invalid weight while keeping valid dates (covers null path around 128/129)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([
      { uuid: 'p-w', name: 'Weighty', min_dry_weight_g: 1, max_water_weight_g: 1, recommended_water_threshold_pct: 10 },
    ])
    // Include an entry with invalid weight but valid date to hit the !isFinite(w) branch
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-06-02 10:00:00', measured_weight_g: 10 },
      { measured_at: '2024-06-01 10:00:00', measured_weight_g: 'NaN' }, // invalid weight → filtered
      { measured_at: '2024-05-31 10:00:00', measured_weight_g: 9 },
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
    // Only two valid items should remain
    expect(props.data.length).toBe(2)
    // Ensure the titles correspond to the two valid dates (sanity)
    const titles = props.data.map(p => p.title)
    expect(titles.join(' | ')).toMatch(/2024-06-02|2024-05-31/)
  })

  test('skips measurements missing measured_at during per-day collapse (covers 119 falsy branch)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([
      { uuid: 'p-day', name: 'DayKey', min_dry_weight_g: 1, max_water_weight_g: 1, recommended_water_threshold_pct: 10 },
    ])
    // Include one entry with measured_at missing; it should be ignored in per-day pass
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-09-02 10:00:00', measured_weight_g: 10 },
      { measured_weight_g: 9 }, // no measured_at
      { measured_at: '2024-09-01 10:00:00', measured_weight_g: 8 },
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
    expect(props.data.length).toBe(2)
  })

  test('outer measurements catch without message uses default text (covers 143 default branch)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([{ uuid: 'p-outer', name: 'Outer' }])

    const allSpy = vi.spyOn(Promise, 'all').mockImplementation(() => { throw {} })

    try {
      const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')
      render(
        <ThemeProvider>
          <MemoryRouter>
            <Dashboard />
          </MemoryRouter>
        </ThemeProvider>
      )
      const alert = await screen.findByRole('alert')
      expect(alert.textContent || '').toMatch(/failed to load measurements/i)
    } finally {
      allSpy.mockRestore()
    }
  })

  test('localStorage.setItem throws are safely ignored for both toggle and select (covers 180 and 192)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    // One plant with two valid points to render chart and controls
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([{ uuid: 'p-ls', name: 'Persist' }])
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-07-02 10:00:00', measured_weight_g: 2 },
      { measured_at: '2024-07-01 10:00:00', measured_weight_g: 1 },
    ])

    // Spy on localStorage.setItem to throw
    const setItemSpy = vi.spyOn(localStorage.__proto__, 'setItem').mockImplementation(() => { throw new Error('denied') })

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')
    // Ensure default for suggested interval is true by clearing any persisted off state
    localStorage.removeItem('chart.showSuggestedInterval')
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Toggle suggested interval off – state should update despite setItem throwing
    const toggle = await screen.findByLabelText(/show suggested watering interval/i)
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()

    // Change charts per row – state updates and no crash despite setItem throwing
    const select = screen.getByRole('combobox', { name: /charts per row/i })
    fireEvent.change(select, { target: { value: '5' } })
    expect(select).toHaveValue('5')

    setItemSpy.mockRestore()
  })

  test('navigates on Enter and Space keydown on plant card (covers 264-268)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')
    const navigate = vi.fn()
    vi.doMock('react-router-dom', async () => {
      const actual = await vi.importActual('react-router-dom')
      return { ...actual, useNavigate: () => navigate }
    })

    const plant = { uuid: 'p-key', name: 'KeyNav' }
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([plant])
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-01-02 10:00:00', measured_weight_g: 20 },
      { measured_at: '2024-01-01 10:00:00', measured_weight_g: 10 },
    ])

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    const card = await screen.findByTitle('Open statistics')

    // Enter key
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' })
    expect(navigate).toHaveBeenCalledWith('/stats/p-key', { state: { plant } })

    // Space key
    fireEvent.keyDown(card, { key: ' ', code: 'Space' })
    expect(navigate).toHaveBeenCalledWith('/stats/p-key', { state: { plant } })
    expect(navigate).toHaveBeenCalledTimes(2)
  })
})

// --- additional coverage for remaining branches/funcs ---
describe('pages/Dashboard – additional coverage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    localStorage.clear()
  })

  test('ignores AbortError from plants loader and does not show error (covers 52-54)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    // Simulate AbortError thrown by fetch
    vi.spyOn(plantsApi, 'list').mockRejectedValueOnce({ name: 'AbortError', message: 'aborted' })

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // After effect completes, no error banner, but empty state visible
    await screen.findByText(/no plants yet/i)
    expect(screen.queryByText(/failed to load plants/i)).not.toBeInTheDocument()
  })

  test('applies dark theme card colors (covers 196-197)', async () => {
    // Mock ThemeContext to force dark theme for this test only
    vi.doMock('../../../src/ThemeContext.jsx', () => {
      const React = require('react')
      return {
        useTheme: () => ({ effectiveTheme: 'dark' }),
        ThemeProvider: ({ children }) => React.createElement(React.Fragment, null, children),
      }
    })

    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([
      { uuid: 'p-dark', name: 'Darkly' },
    ])
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-03-02 10:00:00', measured_weight_g: 10 },
      { measured_at: '2024-03-01 10:00:00', measured_weight_g: 9 },
    ])

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      // ThemeProvider here is the mocked pass-through
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    const title = await screen.findByText('Darkly')
    const card = title.closest('[title="Open statistics"]')
    expect(card).toBeTruthy()
    const style = card.getAttribute('style') || ''
    // Dark theme background and border colors from Dashboard.jsx (allow rgb() normalization)
    expect(style).toMatch(/background:\s*(#111827|rgb\(17, 24, 39\))/)
    expect(style).toMatch(/border:\s*1px solid (#374151|rgb\(55, 65, 81\))/)
  })

  test('persists charts-per-row and reads default (covers 37 and executes 172-174 finite path)', async () => {
    // Ensure initializer branch uses default (no stored value)
    localStorage.removeItem('dashboard.chartsPerRow')
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    // Return one plant with valid series so the controls are visible and chart renders
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([
      { uuid: 'p-grid', name: 'Grid', min_dry_weight_g: 1, max_water_weight_g: 1, recommended_water_threshold_pct: 10 },
    ])
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-01-02 10:00:00', measured_weight_g: 2 },
      { measured_at: '2024-01-01 10:00:00', measured_weight_g: 1 },
    ])

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    const select = await screen.findByRole('combobox', { name: /charts per row/i })

    // Initially, no stored value -> default 2 from initializer (line 37)
    expect(select).toHaveValue('2')

    // Change to 1 (valid option) -> persists
    fireEvent.change(select, { target: { value: '1' } })
    await waitFor(() => {
      expect(localStorage.getItem('dashboard.chartsPerRow')).toBe('1')
    })

    // Change to 5 (valid option) -> persists
    fireEvent.change(select, { target: { value: '5' } })
    await waitFor(() => {
      expect(localStorage.getItem('dashboard.chartsPerRow')).toBe('5')
    })
  })

  test('plants loader returns non-array and defaults to [] (covers branch at line 50)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce(null)

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Should render empty state without errors
    await screen.findByText(/no plants yet/i)
    expect(screen.queryByText(/failed to load plants/i)).not.toBeInTheDocument()
  })

  test('localStorage.setItem throwing during toggles does not crash (covers try/catch around setters)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([
      { uuid: 'p-ls', name: 'LS', min_dry_weight_g: 5, max_water_weight_g: 5, recommended_water_threshold_pct: 20 },
    ])
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-07-02 10:00:00', measured_weight_g: 10 },
      { measured_at: '2024-07-01 10:00:00', measured_weight_g: 9 },
    ])

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    const originalSet = window.localStorage.setItem
    window.localStorage.setItem = () => { throw new Error('quota') }
    try {
      render(
        <ThemeProvider>
          <MemoryRouter>
            <Dashboard />
          </MemoryRouter>
        </ThemeProvider>
      )

      await screen.findByTestId('sparkline')
      const toggle = screen.getByLabelText(/show suggested watering interval/i)
      // initial checked
      expect(toggle).toBeChecked()
      // Toggling should update UI state even if setItem throws
      fireEvent.click(toggle)
      expect(toggle).not.toBeChecked()

      const select = screen.getByRole('combobox', { name: /charts per row/i })
      fireEvent.change(select, { target: { value: '4' } })
      expect(select).toHaveValue('4')
    } finally {
      window.localStorage.setItem = originalSet
    }
  })

  test('measurements all invalid produce empty series (covers map/filter branches)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([{ uuid: 'p-empty', name: 'Empty' }])
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: 'bad-date', measured_weight_g: 10 }, // invalid time
      { measured_at: '2024-01-01 10:00:00', measured_weight_g: NaN }, // invalid weight
    ])

    const { default: Dashboard } = await import('../../../src/pages/Dashboard.jsx')

    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    await screen.findByText('Empty')
    await screen.findByText(/not enough data to chart/i)
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument()
  })
})

describe('Dashboard helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    if (globalThis.localStorage && typeof globalThis.localStorage.clear === 'function') {
      globalThis.localStorage.clear()
    }
    // Ensure any stubbed globals are restored
    // @ts-ignore
    if (vi.unstubAllGlobals) vi.unstubAllGlobals()
  })

  test('safeLocalGetItem returns value on success and null when getItem throws (covers 35-36)', async () => {
    const { safeLocalGetItem } = await import('../../../src/pages/Dashboard.jsx')
    localStorage.setItem('k', 'v')
    expect(safeLocalGetItem('k')).toBe('v')

    const spy = vi.spyOn(localStorage.__proto__, 'getItem').mockImplementation(() => { throw new Error('nope') })
    expect(safeLocalGetItem('k')).toBeNull()
    spy.mockRestore()

    // Simulate environment without localStorage
    vi.stubGlobal('localStorage', undefined)
    expect(safeLocalGetItem('k')).toBeNull()
    // Restore stubbed globals
    // @ts-ignore
    if (vi.unstubAllGlobals) vi.unstubAllGlobals()
  })

  test('toTimestamp handles valid, invalid, and missing measured_at', async () => {
    const { toTimestamp } = await import('../../../src/pages/Dashboard.jsx')
    expect(Number.isFinite(toTimestamp({ measured_at: '2025-01-01 00:00:00' }))).toBe(true)
    expect(Number.isFinite(toTimestamp({ measured_at: 'bad-date' }))).toBe(false)
    expect(Number.isFinite(toTimestamp({}))).toBe(false)
  })

  test('safeSetItem swallows errors and persists on success', async () => {
    const { safeSetItem, safeLocalGetItem } = await import('../../../src/pages/Dashboard.jsx')
    const spy = vi.spyOn(localStorage.__proto__, 'setItem').mockImplementation(() => { throw new Error('denied') })
    // Should not throw
    expect(() => safeSetItem('a', '1')).not.toThrow()
    spy.mockRestore()

    // Success path
    safeSetItem('a', '2')
    expect(safeLocalGetItem('a')).toBe('2')
  })
})

describe('pages/Dashboard – helper functions coverage', () => {
  test('clampChartsPerRow covers all branches', async () => {
    const { clampChartsPerRow } = await import('../../../src/pages/Dashboard.jsx')
    expect(clampChartsPerRow('abc')).toBe(2)
    expect(clampChartsPerRow('0')).toBe(1)
    expect(clampChartsPerRow('10')).toBe(5)
    expect(clampChartsPerRow('3')).toBe(3)
  })

  test('getInitialChartsPerRow returns default or valid numbers', async () => {
    const { getInitialChartsPerRow } = await import('../../../src/pages/Dashboard.jsx')
    expect(getInitialChartsPerRow(() => null)).toBe(2)
    expect(getInitialChartsPerRow(() => '4')).toBe(4)
    // Non-function getItem path
    expect(getInitialChartsPerRow(null)).toBe(2)
  })

  test('isAbortError identifies abort-like errors', async () => {
    const { isAbortError } = await import('../../../src/pages/Dashboard.jsx')
    expect(isAbortError({ name: 'AbortError' })).toBe(true)
    expect(isAbortError(new Error('Request aborted by user'))).toBe(true)
    expect(isAbortError(new Error('Boom'))).toBe(false)
  })

  test('arrayOrEmpty returns array or empty array', async () => {
    const { arrayOrEmpty } = await import('../../../src/pages/Dashboard.jsx')
    expect(arrayOrEmpty([1, 2])).toEqual([1, 2])
    expect(arrayOrEmpty(null)).toEqual([])
  })
})

describe('pages/Dashboard – refLines toggle branches', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    localStorage.clear()
  })

  test('toggling min/max/thresh checkboxes removes refLines (covers false branches)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const { measurementsApi } = await import('../../../src/api/measurements')

    const plant = {
      uuid: 'p-ref',
      name: 'Refs',
      min_dry_weight_g: 10,
      max_water_weight_g: 10,
      recommended_water_threshold_pct: 50,
    }
    vi.spyOn(plantsApi, 'list').mockResolvedValueOnce([plant])
    vi.spyOn(measurementsApi, 'listByPlant').mockResolvedValueOnce([
      { measured_at: '2024-06-02 10:00:00', measured_weight_g: 22 },
      { measured_at: '2024-06-01 10:00:00', measured_weight_g: 20 },
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
    let props = JSON.parse(spark.getAttribute('data-props'))
    expect(Array.isArray(props.refLines)).toBe(true)
    expect(props.refLines.length).toBe(3)

    // Toggle off all three
    fireEvent.click(screen.getByLabelText(/show min dry weight/i))
    fireEvent.click(screen.getByLabelText(/show max water weight/i))
    fireEvent.click(screen.getByLabelText(/recommended threshold/i))

    // Query again to get updated props
    const spark2 = await screen.findByTestId('sparkline')
    props = JSON.parse(spark2.getAttribute('data-props'))
    expect(props.refLines.length).toBe(0)
  })
})
