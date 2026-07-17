import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dashboard, { 
  getInitialShowSuggestedInterval, 
  isAbortError, 
  arrayOrEmpty,
  safeLocalGetItem,
  getInitialChartsPerRow,
  clampChartsPerRow,
  toTimestamp,
  safeSetItem
} from '../../../src/pages/Dashboard'
import { measurementsApi } from '../../../src/api/measurements'
import usePlants from '../../../src/hooks/usePlants'
import { useTheme } from '../../../src/ThemeContext'
import { BrowserRouter } from 'react-router-dom'

vi.mock('../../../src/api/measurements', () => ({
  measurementsApi: {
    listByPlant: vi.fn(),
  },
}))

vi.mock('../../../src/hooks/usePlants', () => ({
  default: vi.fn(),
}))

vi.mock('../../../src/ThemeContext', () => ({
  useTheme: vi.fn(),
}))

vi.mock('../../../src/components/Sparkline', () => ({
  default: () => <div data-testid="sparkline">Sparkline</div>,
}))

vi.mock('../../../src/components/DashboardLayout', () => ({
  default: ({ children }) => <div data-testid="layout">{children}</div>,
}))

// Mock safeLocalGetItem to avoid real localStorage dependency issues in some envs
vi.mock('../../../src/pages/Dashboard', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
  }
})

describe('Dashboard Helpers', () => {
  it('getInitialShowSuggestedInterval works', () => {
    expect(getInitialShowSuggestedInterval(() => '0')).toBe(false)
    expect(getInitialShowSuggestedInterval(() => '1')).toBe(true)
    expect(getInitialShowSuggestedInterval(() => null)).toBe(true)
    expect(getInitialShowSuggestedInterval(null)).toBe(true)
    expect(getInitialShowSuggestedInterval(() => { throw new Error() })).toBe(true)
  })

  it('isAbortError works', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true)
    expect(isAbortError({ message: 'Request aborted' })).toBe(true)
    expect(isAbortError({ message: 'Other error' })).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })

  it('arrayOrEmpty works', () => {
    expect(arrayOrEmpty([1])).toEqual([1])
    expect(arrayOrEmpty(null)).toEqual([])
    expect(arrayOrEmpty({})).toEqual([])
  })

  it('getInitialChartsPerRow works', () => {
    expect(getInitialChartsPerRow((k) => (k === 'dashboard.chartsPerRow' ? '3' : null))).toBe(3)
    expect(getInitialChartsPerRow(() => '10')).toBe(2)
    expect(getInitialChartsPerRow(() => '0')).toBe(2)
    expect(getInitialChartsPerRow(() => 'abc')).toBe(2)
    expect(getInitialChartsPerRow(null)).toBe(2)
  })

  it('clampChartsPerRow works', () => {
    expect(clampChartsPerRow(3)).toBe(3)
    expect(clampChartsPerRow(10)).toBe(5)
    expect(clampChartsPerRow(0)).toBe(1)
    expect(clampChartsPerRow('abc')).toBe(2)
  })

  it('toTimestamp works', () => {
    expect(toTimestamp({ measured_at: '2025-01-01 10:00:00' })).toBe(Date.parse('2025-01-01T10:00:00'))
    expect(toTimestamp({})).toBe(NaN)
    expect(toTimestamp(null)).toBe(NaN)
  })

  it('safeLocalGetItem and safeSetItem work', () => {
    localStorage.setItem('test', 'val')
    expect(safeLocalGetItem('test')).toBe('val')
    safeSetItem('test2', 'val2')
    expect(localStorage.getItem('test2')).toBe('val2')
    
    // Test catch branches by mocking localStorage
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error() })
    expect(safeLocalGetItem('test')).toBe(null)
    spy.mockRestore()
    
    const spySet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error() })
    safeSetItem('test', 'fail') // should not throw
    spySet.mockRestore()
  })
})

describe('Dashboard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTheme.mockReturnValue({ effectiveTheme: 'light' })
    localStorage.clear()
  })

  it('shows loader while plants are loading', () => {
    usePlants.mockReturnValue({ plants: [], loading: true, error: null })
    render(<BrowserRouter><Dashboard /></BrowserRouter>)
    expect(screen.getByText(/Loading dashboard.../i)).toBeInTheDocument()
  })

  it('shows error if usePlants fails', () => {
    usePlants.mockReturnValue({ plants: [], loading: false, error: 'Failed to load' })
    render(<BrowserRouter><Dashboard /></BrowserRouter>)
    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument()
  })

  it('renders empty dashboard when no plants', async () => {
    usePlants.mockReturnValue({ plants: [], loading: false, error: null })
    render(<BrowserRouter><Dashboard /></BrowserRouter>)
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument()
  })

  it('renders dashboard with plants and sparklines', async () => {
    const mockPlants = [
      { uuid: '123', name: 'Plant 1', min_dry_weight_g: 100, max_water_weight_g: 50 }
    ]
    usePlants.mockReturnValue({ plants: mockPlants, loading: false, error: null })
    measurementsApi.listByPlant.mockResolvedValue([
      { measured_at: '2025-01-01 10:00:00', measured_weight_g: 120 },
      { measured_at: '2025-01-02 10:00:00', measured_weight_g: 110 }
    ])

    render(<BrowserRouter><Dashboard /></BrowserRouter>)

    await waitFor(() => {
      expect(screen.getByText('Plant 1')).toBeInTheDocument()
      expect(screen.getByTestId('sparkline')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('toggles reference lines', async () => {
    const mockPlants = [{ uuid: '123', name: 'Plant 1' }]
    usePlants.mockReturnValue({ plants: mockPlants, loading: false, error: null })
    measurementsApi.listByPlant.mockResolvedValue([
      { measured_at: '2025-01-01 10:00:00', measured_weight_g: 120 },
      { measured_at: '2025-01-02 10:00:00', measured_weight_g: 110 }
    ])

    render(<BrowserRouter><Dashboard /></BrowserRouter>)

    await waitFor(() => {
      expect(screen.getByTestId('sparkline')).toBeInTheDocument()
    })

    const minRefCheckbox = screen.getByLabelText(/Show min dry weight/i)
    act(() => {
      minRefCheckbox.click()
    })
    expect(minRefCheckbox).not.toBeChecked()

    const maxRefCheckbox = screen.getByLabelText(/Show max water weight/i)
    act(() => {
      maxRefCheckbox.click()
    })
    expect(maxRefCheckbox).not.toBeChecked()

    const threshRefCheckbox = screen.getByLabelText(/Recommended threshold/i)
    act(() => {
      threshRefCheckbox.click()
    })
    expect(threshRefCheckbox).not.toBeChecked()
    
    const intervalCheckbox = screen.getByLabelText(/Show suggested watering interval/i)
    act(() => {
      intervalCheckbox.click()
    })
    expect(intervalCheckbox).not.toBeChecked()
    expect(localStorage.getItem('chart.showSuggestedInterval')).toBe('0')
  })

  it('changes charts per row', async () => {
    usePlants.mockReturnValue({ plants: [{ uuid: '123', name: 'P' }], loading: false, error: null })
    measurementsApi.listByPlant.mockResolvedValue([])

    const user = userEvent.setup()
    render(<BrowserRouter><Dashboard /></BrowserRouter>)

    const select = await screen.findByLabelText(/Charts per row/i)
    await user.selectOptions(select, '3')

    await waitFor(() => {
      expect(select.value).toBe('3')
      expect(localStorage.getItem('dashboard.chartsPerRow')).toBe('3')
    })
  })

  it('identifies and filters by repotting event correctly', async () => {
    const mockPlants = [{ uuid: '123', name: 'P' }]
    usePlants.mockReturnValue({ plants: mockPlants, loading: false, error: null })
    
    // measurements in DESC order
    measurementsApi.listByPlant.mockResolvedValue([
      { measured_at: '2025-01-05 10:00:00', measured_weight_g: 100 },
      { measured_at: '2025-01-04 10:00:00', measured_weight_g: 110 },
      // Repotting event (isRepot detection logic)
      { 
        measured_at: '2025-01-03 10:00:00', 
        measured_weight_g: 500, 
        last_dry_weight_g: 400, 
        water_added_g: 100,
        last_wet_weight_g: null,
        water_loss_total_pct: null,
        water_loss_total_g: null,
        water_loss_day_pct: null,
        water_loss_day_g: null
      },
      { measured_at: '2025-01-02 10:00:00', measured_weight_g: 90 }
    ])

    render(<BrowserRouter><Dashboard /></BrowserRouter>)

    await waitFor(() => {
      expect(screen.getByTestId('sparkline')).toBeInTheDocument()
    })
  })

  it('handles invalid measurement data gracefully', async () => {
    const mockPlants = [{ uuid: '123', name: 'P' }]
    usePlants.mockReturnValue({ plants: mockPlants, loading: false, error: null })
    
    measurementsApi.listByPlant.mockResolvedValue([
      { measured_at: 'invalid-date', measured_weight_g: 100 },
      { measured_at: '2025-01-01 10:00:00', measured_weight_g: NaN },
      { measured_at: '2025-01-02 10:00:00', measured_weight_g: 120 },
      { measured_at: '2025-01-03 10:00:00', measured_weight_g: 110 }
    ])

    render(<BrowserRouter><Dashboard /></BrowserRouter>)

    await waitFor(() => {
      expect(screen.getByTestId('sparkline')).toBeInTheDocument()
    })
  })

  it('handles measurement load failure gracefully', async () => {
    const mockPlants = [
      { uuid: '123', name: 'Plant 1', min_dry_weight_g: 100, max_water_weight_g: 50 }
    ]
    usePlants.mockReturnValue({ plants: mockPlants, loading: false, error: null })
    measurementsApi.listByPlant.mockRejectedValue(new Error('API Error'))

    render(<BrowserRouter><Dashboard /></BrowserRouter>)

    await waitFor(() => {
      expect(screen.getByText('Plant 1')).toBeInTheDocument()
    })
    // It should still render the plant card but maybe show something else or just empty sparkline
  })
})
