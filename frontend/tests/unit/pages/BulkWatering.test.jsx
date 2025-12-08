import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import BulkWatering from '../../../src/pages/BulkWatering.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'

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
})
