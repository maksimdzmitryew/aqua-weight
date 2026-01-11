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
    expect(await screen.findByText(/no plants found/i)).toBeInTheDocument()
  })
  test('initially shows only plants that needed watering; toggle shows all and deemphasizes above-threshold', async () => {
    renderPage()

    // Handlers provide Aloe (needs) and Monstera (does not). Initially show only needs-water snapshot → Aloe only
    expect(await screen.findByText('Aloe')).toBeInTheDocument()
    // Monstera should not be visible until we toggle
    expect(screen.queryByText('Monstera')).not.toBeInTheDocument()

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

    // Enter valid number and blur → create path; badge text should update from 20% to 40% (per handler)
    fireEvent.change(input, { target: { value: '123' } })
    fireEvent.blur(input)
    // Success styling applied
    await waitFor(() => expect(input.className).toMatch(/bg-success/))
    // Updated retained percentage in the same row
    expect(await within(row).findByText(/40%/)).toBeInTheDocument()

    // Second commit triggers update path → retained becomes 42%
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '124' } })
    fireEvent.blur(input)
    expect(await within(row).findByText(/42%/)).toBeInTheDocument()
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
    expect(await within(row).findByText(/40%/)).toBeInTheDocument()

    // Second commit (PUT) omits metrics, so retained in UI should remain 40%
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '201' } })
    fireEvent.blur(input)
    expect(await within(row).findByText(/40%/)).toBeInTheDocument()
  })
})
