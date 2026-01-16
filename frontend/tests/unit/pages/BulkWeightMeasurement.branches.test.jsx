import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

// Mock useNavigate to verify it is NOT called when handleView receives plant without uuid
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    __esModule: true,
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('pages/BulkWeightMeasurement (branches)', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  test('handleView returns early when plant has no uuid (no navigation)', async () => {
    // Mock the table to immediately call onViewPlant with a plant missing uuid to cover the guard
    vi.resetModules()
    vi.doMock('../../../src/components/BulkMeasurementTable.jsx', () => ({
      __esModule: true,
      default: ({ onViewPlant }) => {
        onViewPlant?.({ name: 'NoId' })
        return <div>Mocked Table</div>
      },
    }))

    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>
    )
    // The mock invoked onViewPlant with no uuid; ensure navigate was not called
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(await screen.findByText('Mocked Table')).toBeInTheDocument()
  })

  test('useMemo branch: when initial snapshot is empty, toggling off shows empty state', async () => {
    // Return plants that are all ABOVE threshold so none "needs water" at initial load
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'p1', name: 'ZZ Plant', water_retained_pct: 80, recommended_water_threshold_pct: 30 },
      ]))
    )

    vi.resetModules()
    vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>
    )

    expect(await screen.findByText('ZZ Plant')).toBeInTheDocument()

    // Toggle off "Show all" -> since initialNeedsWaterIds is empty, table should render empty state
    const toggle = screen.getByRole('checkbox', { name: /show all plants/i })
    fireEvent.click(toggle)
    expect(screen.getByText(/no plants found/i)).toBeInTheDocument()
  })

  test('Array.isArray(data) false branch: non-array plants response yields empty list gracefully', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ message: 'not-an-array' }))
    )

    vi.resetModules()
    vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Falls back to [] and renders empty state
    expect(await screen.findByText(/no plants found/i)).toBeInTheDocument()
  })

  test('OR-chain fallback for timestamps and nullish metrics keep previous values', async () => {
    // Plant without latest_at/measured_at to force deepest fallback path to nowLocalISOMinutes()
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'w1', name: 'Cactus', water_retained_pct: 22, water_loss_total_pct: 78, recommended_water_threshold_pct: 30 },
      ])),
      // Weight POST returns without timestamps and without metrics -> component should keep previous percentages
      http.post('/api/measurements/weight', async ({ request }) => {
        const payload = await request.json()
        return HttpResponse.json({ id: 501, plant_id: payload?.plant_id })
      })
    )

    vi.resetModules()
    vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>
    )

    const cell = await screen.findByText('Cactus')
    const row = cell.closest('tr')
    const input = within(row).getByRole('spinbutton')

    // Enter a valid weight to trigger POST and state update
    fireEvent.change(input, { target: { value: '123' } })
    fireEvent.blur(input)

    // Percentages should remain as previous since API omitted them (nullish coalescing branch)
    expect(within(row).getByText(/22%/)).toBeInTheDocument()
    expect(within(row).getByText(/78%/)).toBeInTheDocument()
  })

  test('operationMode defaults to null if localStorage is undefined', async () => {
    const originalLocalStorage = global.localStorage
    delete global.localStorage

    try {
      vi.resetModules()
      vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
      const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
      render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      )

      // If operationMode is null (not 'vacation'), it should show the "Show all plants" checkbox
      expect(await screen.findByText(/Show all plants/i)).toBeInTheDocument()
    } finally {
      global.localStorage = originalLocalStorage
    }
  })
})
