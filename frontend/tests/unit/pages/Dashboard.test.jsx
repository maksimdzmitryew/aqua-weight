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

// Mock useNavigate to capture navigations
const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  }
})

// Mock APIs used by Dashboard
vi.mock('../../../src/api/plants', () => ({
  plantsApi: {
    list: vi.fn(),
  },
}))
vi.mock('../../../src/api/measurements', () => ({
  measurementsApi: {
    listByPlant: vi.fn(),
  },
}))

// Will import mocked modules within tests after vi.mock took effect

describe('pages/Dashboard', () => {
  test('renders dashboard layout and welcome text', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    plantsApi.list.mockResolvedValueOnce([])
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
    plantsApi.list.mockResolvedValueOnce([])
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
    expect(measurementsApi.listByPlant).not.toHaveBeenCalled()
  })

  test('handles plants load error gracefully (covers 48-53)', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    plantsApi.list.mockRejectedValueOnce(new Error('Boom'))
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
    plantsApi.list.mockResolvedValueOnce([plant])

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
    measurementsApi.listByPlant.mockResolvedValueOnce(meas)

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

    // Click on card navigates to stats
    const titleEl = screen.getByText('Aloe')
    const card = titleEl.closest('[title="Open statistics"]')
    expect(card).toBeTruthy()
    fireEvent.click(card)
    expect(navigateSpy).toHaveBeenCalledWith('/stats/p-1', { state: { plant } })
  })

  test('shows "Not enough data" when <= 1 point', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    plantsApi.list.mockResolvedValueOnce([{ uuid: 'p-2', name: 'Monstera' }])
    // Return single valid point only -> sparkline not shown
    const { measurementsApi } = await import('../../../src/api/measurements')
    measurementsApi.listByPlant.mockResolvedValueOnce([
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
})
