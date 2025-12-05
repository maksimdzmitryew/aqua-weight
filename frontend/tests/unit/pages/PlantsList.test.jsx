import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantsList from '../../../src/pages/PlantsList.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
}

test('renders plants after loading', async () => {
  renderPage()
  expect(await screen.findByText('Aloe')).toBeInTheDocument()
  expect(screen.getByText('Monstera')).toBeInTheDocument()
})

test('renders empty state when no plants', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([]))
  )
  renderPage()
  // EmptyState uses role "note"
  const note = await screen.findByRole('note')
  expect(note).toBeInTheDocument()
})

test('shows error notice on API failure', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json({ message: 'Network down' }, { status: 500 }))
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/network down/i)
})

test('numeric search filters by threshold (<= query)', async () => {
  // Provide custom plants including thresholds to exercise numeric filter branch
  server.use(
    http.get('/api/plants', () => {
      return HttpResponse.json([
        { uuid: 'a', name: 'Low', recommended_water_threshold_pct: 20 },
        { uuid: 'b', name: 'Edge', recommended_water_threshold_pct: 30 },
        { uuid: 'c', name: 'High', recommended_water_threshold_pct: 45 },
      ])
    })
  )
  renderPage()

  // Ensure items are loaded
  expect(await screen.findByText('Low')).toBeInTheDocument()

  // input type="search" has role 'searchbox' per ARIA; reflect component change
  const search = screen.getByRole('searchbox', { name: /search plants/i })
  await userEvent.clear(search)
  await userEvent.type(search, '30')

  // Now only items with threshold <= 30 should be visible in the limited list
  expect(screen.getByText('Low')).toBeInTheDocument()
  expect(screen.getByText('Edge')).toBeInTheDocument()
  // The one above threshold should be filtered out
  expect(screen.queryByText('High')).not.toBeInTheDocument()

  // Meta text reflects filtered count
  expect(screen.getByText(/Showing 2 of 3/)).toBeInTheDocument()
})
