import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import DailyCare from '../../../src/pages/DailyCare.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <DailyCare />
      </MemoryRouter>
    </ThemeProvider>
  )
}

test('shows tasks table with measure/water indicators', async () => {
  // default MSW handlers provide two plants; one will need water (20%), both need measurement (>18h)
  renderPage()

  // Table should appear once loaded
  const table = await screen.findByRole('table')
  const rows = within(table).getAllByRole('row')
  // header + 2 items
  expect(rows.length).toBeGreaterThanOrEqual(3)

  // Check accessible names on status icons (role="img")
  // There should be icons for measurement state, and at least one for watering needed
  expect(await screen.findAllByRole('img', { name: /Needs measurement|No measurement needed/ })).toBeTruthy()
  expect(await screen.findByRole('img', { name: 'Needs watering' })).toBeInTheDocument()
})

test('renders empty state when no tasks are due', async () => {
  // All plants above water threshold and recently updated (future time) → no tasks
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      {
        uuid: 'x1', id: 1, name: 'Fern', latest_at: '2999-01-01T00:00:00', water_retained_pct: 80,
      },
    ]))
  )
  renderPage()
  const note = await screen.findByRole('note')
  expect(note).toHaveTextContent(/No tasks for today/i)
})

test('shows error notice when API fails', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/boom/i)
})
