import React from 'react'
import { render, screen, within } from '@testing-library/react'
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
  test('initially shows only plants that needed watering; toggle shows all and deemphasizes above-threshold', async () => {
    renderPage()

    // Handlers provide Aloe (needs) and Monstera (does not). Initially show only needs-water snapshot → Aloe only
    expect(await screen.findByText('Aloe')).toBeInTheDocument()
    // Monstera should not be visible until we toggle
    expect(screen.queryByText('Monstera')).not.toBeInTheDocument()

    // Toggle "Show all plants"
    const toggle = screen.getByRole('checkbox', { name: /show all plants/i })
    await userEvent.click(toggle)

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
    await userEvent.clear(input)
    await userEvent.type(input, '-5')
    await userEvent.tab() // blur
    expect(input.className).toMatch(/bg-error/)

    // Enter valid number and blur → create path; badge text should update from 20% to 40% (per handler)
    await userEvent.clear(input)
    await userEvent.type(input, '123')
    await userEvent.tab()
    // Success styling applied
    expect(input.className).toMatch(/bg-success/)
    // Updated retained percentage in the same row
    expect(within(row).getByText(/40%/)).toBeInTheDocument()

    // Second commit triggers update path → retained becomes 42%
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, '124')
    await userEvent.tab()
    expect(within(row).getByText(/42%/)).toBeInTheDocument()
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
    await userEvent.click(aloe)
    expect(mockNavigate).toHaveBeenCalledWith('/plants/u1', expect.objectContaining({ state: expect.any(Object) }))
  })

  test('handles wrapped API response {status, data} and logs on error in update path', async () => {
    const user = userEvent.setup()
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

    await user.clear(input)
    await user.type(input, '130')
    await user.tab()
    expect(within(row).getByText(/55%/)).toBeInTheDocument()

    // Now make PUT fail to exercise catch path
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      http.put('/api/measurements/watering/:id', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    )

    await user.click(input)
    await user.clear(input)
    await user.type(input, '131')
    await user.tab()

    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
