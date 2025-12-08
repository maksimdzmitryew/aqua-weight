import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import BulkWeightMeasurement from '../../../src/pages/BulkWeightMeasurement.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <BulkWeightMeasurement />
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/BulkWeightMeasurement', () => {
  test('default shows all plants; toggling off shows only needs-water snapshot', async () => {
    renderPage()

    // Default showAll = true → both plants from handlers
    expect(await screen.findByText('Aloe')).toBeInTheDocument()
    expect(screen.getByText('Monstera')).toBeInTheDocument()

    // Toggle off → only needs-water snapshot (Aloe) should remain
    const toggle = screen.getByRole('checkbox', { name: /show all plants/i })
    await userEvent.click(toggle) // uncheck

    expect(screen.getByText('Aloe')).toBeInTheDocument()
    expect(screen.queryByText('Monstera')).not.toBeInTheDocument()
  })

  test('committing weight creates then updates measurement; invalid negative marks error', async () => {
    // Handlers for weight endpoints
    server.use(
      http.post('/api/measurements/weight', async ({ request }) => {
        const payload = await request.json()
        return HttpResponse.json({
          id: 2001,
          plant_id: payload?.plant_id,
          measured_at: payload?.measured_at || '2025-01-03T00:00:00',
          latest_at: payload?.measured_at || '2025-01-03T00:00:00',
          water_retained_pct: 35,
          water_loss_total_pct: 65,
        })
      }),
      http.put('/api/measurements/weight/:id', async ({ request, params }) => {
        const payload = await request.json()
        return HttpResponse.json({
          id: Number(params.id) || 2001,
          plant_id: payload?.plant_id,
          measured_at: payload?.measured_at || '2025-01-04T00:00:00',
          latest_at: payload?.measured_at || '2025-01-04T00:00:00',
          water_retained_pct: 37,
          water_loss_total_pct: 63,
        })
      })
    )

    renderPage()

    // Work with Aloe row
    const aloeCell = await screen.findByText('Aloe')
    const row = aloeCell.closest('tr')
    const input = within(row).getByRole('spinbutton')

    // Negative → error on blur
    await userEvent.clear(input)
    await userEvent.type(input, '-1')
    await userEvent.tab()
    expect(input.className).toMatch(/bg-error/)

    // Valid number → create → retained 35%
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, '100')
    await userEvent.tab()
    expect(input.className).toMatch(/bg-success/)
    expect(within(row).getByText(/35%/)).toBeInTheDocument()

    // Second commit → update → retained 37%
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, '101')
    await userEvent.tab()
    expect(within(row).getByText(/37%/)).toBeInTheDocument()
  })

  test('shows error when plants API fails', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ message: 'nope' }, { status: 500 }))
    )
    renderPage()
    expect(await screen.findByText(/failed to load plants/i)).toBeInTheDocument()
  })
})
