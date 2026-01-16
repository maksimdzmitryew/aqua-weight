import React from 'react'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import BulkWatering from '../../../src/pages/BulkWatering.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

// Mock useNavigate to verify navigation from handleView
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    __esModule: true,
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <BulkWatering />
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/BulkWatering', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })
  test('handles non-array plants response gracefully and shows empty state', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ foo: 'bar' }))
    )

    renderPage()
    // Should not crash; table renders empty state row
    expect(await screen.findByText(/no plants need watering/i)).toBeInTheDocument()
  })
  test('initially shows only plants that needed watering; toggle shows all and deemphasizes above-threshold', async () => {
    renderPage()

    // Handlers provide Aloe (needs) and Monstera (does not). Initially show only needs-water snapshot → Aloe only
    expect(await screen.findByText('Aloe')).toBeInTheDocument()
    // Monstera should not be visible until we toggle
    expect(screen.queryByText('Monstera')).not.toBeInTheDocument()

    // Should see default instructions
    expect(screen.getAllByText(/retained ≤ threshold/i)).toHaveLength(2)

    // Toggle "Show all plants"
    const toggle = screen.getByRole('checkbox', { name: /show all plants/i })
    fireEvent.click(toggle) // uncheck

    // Both rows appear
    expect(await screen.findByText('Monstera')).toBeInTheDocument()

    // The row for Monstera (above threshold) should be deemphasized (opacity applied to <tr>)
    const rows = screen.getAllByRole('row').slice(1)
    const monRow = rows.find(r => within(r).queryByText('Monstera'))
    expect(monRow).toBeTruthy()
    expect(monRow.style.opacity).toBe('0.55')
  })

  test('toggling "Show all plants" checkbox changes visibility', async () => {
    // Custom handlers: Aloe needs water (20 <= 30), Monstera does not (50 > 30)
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
        { uuid: 'u2', name: 'Monstera', water_retained_pct: 50, recommended_water_threshold_pct: 30 }
      ]))
    )

    renderPage()

    // Initially only Aloe is shown
    expect(await screen.findByText('Aloe')).toBeInTheDocument()
    expect(screen.queryByText('Monstera')).not.toBeInTheDocument()

    // Toggle "Show all plants"
    const toggle = screen.getByRole('checkbox', { name: /show all plants/i })
    fireEvent.click(toggle)

    // Now both should be visible
    expect(await screen.findByText('Monstera')).toBeInTheDocument()
    expect(screen.getByText('Aloe')).toBeInTheDocument()

    // Toggle back
    fireEvent.click(toggle)
    expect(screen.queryByText('Monstera')).not.toBeInTheDocument()
    expect(screen.getByText('Aloe')).toBeInTheDocument()
  })

  test('vacation mode: shows only plants that need watering according to approximation and displays suggested date', async () => {
    localStorage.setItem('operationMode', 'vacation')
    try {
      // Mock plants and approximations
      server.use(
        http.get('/api/plants', () => HttpResponse.json([
          { uuid: 'u1', name: 'Aloe', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
          { uuid: 'u2', name: 'Monstera', water_retained_pct: 50, recommended_water_threshold_pct: 30 }
        ])),
        http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
          items: [
            { plant_uuid: 'u1', days_offset: 0, next_watering_at: '2026-01-12 10:00' }, // Needs water
            { plant_uuid: 'u2', days_offset: 2, next_watering_at: '2026-01-14 10:00' }  // Does not need water
          ]
        }))
      )

      renderPage()

      // Should see vacation mode instructions
      expect(await screen.findAllByText(/according to the approximation schedule/i)).toHaveLength(2)

      // Initially shows only Aloe
      expect(await screen.findByText('Aloe')).toBeInTheDocument()
      expect(screen.queryByText('Monstera')).not.toBeInTheDocument()

      // Should show the suggested date for Aloe (u1)
      // Aloe has days_offset: 0, so no background/red color, just the date and (0d)
      expect(screen.getByText(/12\/01/)).toBeInTheDocument()
      expect(screen.getByText(/\(0d\)/)).toBeInTheDocument()

      // Toggle "Show all plants"
      const toggle = screen.getByRole('checkbox', { name: /show all plants/i })
      fireEvent.click(toggle)

      // Now both appear
      expect(await screen.findByText('Monstera')).toBeInTheDocument()
      // Should show the suggested date for Monstera (u2)
      expect(screen.getByText(/14\/01/)).toBeInTheDocument()
      expect(screen.getByText(/\(2d\)/)).toBeInTheDocument()

      // Add a test case for overdue plant
      server.use(
        http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
          items: [
            { plant_uuid: 'u1', days_offset: -1, next_watering_at: '2026-01-11 10:00' }, // Overdue
          ]
        }))
      )
      // Re-render to pick up new mock
      renderPage()
      expect(await screen.findByText(/\(-1d\)/)).toBeInTheDocument()
      const overdueSpan = screen.getByText(/\(-1d\)/).parentElement
      expect(overdueSpan.style.background).toBe('rgb(254, 202, 202)') // #fecaca
    } finally {
      localStorage.removeItem('operationMode')
    }
  })

  test('vacation mode: handles failure in loading approximations (coverage for lines 43-44)', async () => {
    localStorage.setItem('operationMode', 'vacation')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      server.use(
        http.get('/api/plants', () => HttpResponse.json([
          { uuid: 'u1', name: 'Aloe', water_retained_pct: 10, recommended_water_threshold_pct: 30 }
        ])),
        http.get('/api/measurements/approximation/watering', () => HttpResponse.json(null)) // Line 37: approxData?.items || []
      )

      renderPage()
      // Use queryByText to find the Aloe, and if not present, click toggle
      let aloe = await screen.queryByText('Aloe')
      if (!aloe) {
        const toggle = await screen.findByRole('checkbox', { name: /show all plants/i })
        fireEvent.click(toggle)
      }
      expect(await screen.findByText('Aloe')).toBeInTheDocument()

      // Now test the actual catch block
      server.use(
        http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ message: 'Error' }, { status: 500 }))
      )
      renderPage()
      aloe = await screen.queryByText('Aloe')
      if (!aloe) {
        const toggle = await screen.findByRole('checkbox', { name: /show all plants/i })
        fireEvent.click(toggle)
      }
      expect(await screen.findByText('Aloe')).toBeInTheDocument()
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load approximations', expect.any(Error))
    } finally {
      consoleSpy.mockRestore()
      localStorage.removeItem('operationMode')
    }
  })

  test('committing watering creates measurement then updates on second commit; invalid input marks error', async () => {
    // Ensure default handlers active (watering create/update respond OK)
    renderPage()

    // Row for Aloe present
    const aloeCell = await screen.findByText('Aloe')
    const row = aloeCell.closest('tr')
    const input = within(row).getByRole('spinbutton')

    // Enter negative → error status (no request should be sent by page logic)
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.blur(input)
    expect(input.className).toMatch(/bg-error/)

    // Enter valid number and blur → create path; "Needs water" badge logic might trigger based on response
    fireEvent.change(input, { target: { value: '123' } })
    fireEvent.blur(input)
    // Success styling applied
    await waitFor(() => expect(input.className).toMatch(/bg-success/))
    
    // We restored % display in this column
    expect(await within(row).findByText(/40%/)).toBeInTheDocument()

    // Second commit triggers update path
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '124' } })
    fireEvent.blur(input)
    await waitFor(() => expect(input.className).toMatch(/bg-success/))
    expect(await within(row).findByText(/42%/)).toBeInTheDocument()
  })

  test('correct column label is present', async () => {
    renderPage()
    expect(await screen.findByText('Weight gr, Water date')).toBeInTheDocument()
  })

  test('operationMode defaults to manual if localStorage is undefined', async () => {
    const originalLocalStorage = global.localStorage
    // We want to test line 24 of BulkWatering.jsx: 
    // const operationMode = typeof localStorage !== 'undefined' ? localStorage.getItem('operationMode') : 'manual'
    // ThemeProvider also uses localStorage.
    
    // Use a proxy or just mock getItem to return null/value, but the goal is to trigger the `typeof localStorage === 'undefined'` branch.
    // Since we are in JSDOM, localStorage is usually defined.
    
    // Let's try to just delete it from global
    delete global.localStorage
    
    try {
      // We can't use ThemeProvider if it's not guarded
      render(
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      )
      // Should see manual mode instructions (default)
      expect(await screen.findAllByText(/retained ≤ threshold/i)).not.toHaveLength(0)
    } finally {
      global.localStorage = originalLocalStorage
    }
  })

  test('shows error when plants API fails to load', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ message: 'oops' }, { status: 500 }))
    )

    renderPage()
    // Error message rendered
    expect(await screen.findByText(/failed to load plants/i)).toBeInTheDocument()
  })

  test('clicking plant name navigates to plant details using handleView', async () => {
    renderPage()
    const aloe = await screen.findByText('Aloe')
    fireEvent.click(aloe)
    expect(mockNavigate).toHaveBeenCalledWith('/plants/u1', expect.objectContaining({ state: expect.any(Object) }))

    // Coverage for handleView edge case: no uuid
    // We can't easily click a plant without uuid since it won't be in the table if it's from valid plants list
    // but we can call handleView if it was exported, which it isn't.
    // However, we can mock plantsApi.list to return a plant without uuid and see if clicking it does nothing.
    server.use(
      http.get('/api/plants', () => HttpResponse.json([{ uuid: '', name: 'NoUuid' }]))
    )
    renderPage()
    const toggleCheck = (await screen.findAllByRole('checkbox', { name: /show all plants/i }))[1]
    fireEvent.click(toggleCheck)
    const noUuid = await screen.findByText('NoUuid')
    mockNavigate.mockClear()
    fireEvent.click(noUuid)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('handles wrapped API response {status, data} and logs on error in update path', async () => {
    // First, wrap POST response
    server.use(
      http.post('/api/measurements/watering', async ({ request }) => {
        const payload = await request.json()
        return HttpResponse.json({
          status: 'success',
          data: {
            id: 2001,
            plant_id: payload?.plant_id,
            measured_at: payload?.measured_at || '2025-01-05T00:00:00',
            latest_at: payload?.measured_at || '2025-01-05T00:00:00',
            water_retained_pct: 55,
            water_loss_total_pct: 45,
          },
        }, { status: 201 })
      })
    )

    renderPage()
    const aloeCell = await screen.findByText('Aloe')
    const row = aloeCell.closest('tr')
    const input = within(row).getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '130' } })
    fireEvent.blur(input)
    await waitFor(() => expect(input.className).toMatch(/bg-success/))
    expect(await within(row).findByText(/55%/)).toBeInTheDocument()

    // Now make PUT fail to exercise catch path
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      http.put('/api/measurements/watering/:id', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    )

    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '131' } })
    fireEvent.blur(input)

    await waitFor(() => expect(errSpy).toHaveBeenCalled())
    errSpy.mockRestore()
  })

  test('falls back to now when API omits measured_at/latest_at (OR-chain branch)', async () => {
    // Return a single plant that needs water and has no timestamps
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u3', id: 3, name: 'Cactus', water_retained_pct: 10, recommended_water_threshold_pct: 30 }
      ])),
      // POST without timestamps to exercise fallback in component
      http.post('/api/measurements/watering', async ({ request }) => {
        const payload = await request.json()
        return HttpResponse.json({
          id: 3001,
          plant_id: payload?.plant_id,
          // intentionally omit measured_at and latest_at
          water_retained_pct: 25,
          water_loss_total_pct: 75,
        }, { status: 201 })
      })
    )

    renderPage()

    const cactus = await screen.findByText('Cactus')
    const row = cactus.closest('tr')
    const input = within(row).getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '200' } })
    fireEvent.blur(input)

    // Updated column should display a formatted date (not the empty placeholder)
    // Find the Updated cell (it has DateTimeText inside). We assert that it doesn't show the empty symbol.
    await waitFor(() => {
      const cells = within(row).getAllByRole('cell')
      const updatedCell = cells[cells.length - 1]
      expect(updatedCell.textContent?.trim()).not.toBe('—')
    })

    // Now test with data being present but lacking timestamps
    // Line 111: latest_at: data?.latest_at || data?.measured_at || p.latest_at || nowLocalISOMinutes()
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u4', id: 4, name: 'Jade', water_retained_pct: 10, recommended_water_threshold_pct: 30, latest_at: '2025-01-01T12:00' }
      ])),
      http.post('/api/measurements/watering', () => HttpResponse.json({ id: 4001, plant_id: 'u4' }, { status: 201 }))
    )
    renderPage()
    const jade = await screen.findByText('Jade')
    const jadeRow = jade.closest('tr')
    const jadeInput = within(jadeRow).getByRole('spinbutton')
    fireEvent.change(jadeInput, { target: { value: '300' } })
    fireEvent.blur(jadeInput)
    await waitFor(() => expect(jadeInput.className).toMatch(/bg-success/))
  })

  test('update response missing metrics keeps previous values (nullish coalescing branches)', async () => {
    // First let POST create with metrics 40/60 as per default handler
    // Then make PUT omit both water_retained_pct and water_loss_total_pct
    server.use(
      http.put('/api/measurements/watering/:id', async ({ request, params }) => {
        const payload = await request.json()
        return HttpResponse.json({
          id: Number(params.id),
          plant_id: payload?.plant_id,
          measured_at: payload?.measured_at,
          // omit metrics to force fallback to previous plant values
        })
      })
    )

    renderPage()

    const aloeCell = await screen.findByText('Aloe')
    const row = aloeCell.closest('tr')
    const input = within(row).getByRole('spinbutton')

    // First commit (POST) sets retained to 40%
    fireEvent.change(input, { target: { value: '200' } })
    fireEvent.blur(input)
    await waitFor(() => expect(input.className).toMatch(/bg-success/))
    expect(await within(row).findByText(/40%/)).toBeInTheDocument()

    // Second commit (PUT) omits metrics, so nothing should change in this column
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '201' } })
    fireEvent.blur(input)
    await waitFor(() => expect(input.className).toMatch(/bg-success/))
    expect(await within(row).findByText(/40%/)).toBeInTheDocument()
  })
})
