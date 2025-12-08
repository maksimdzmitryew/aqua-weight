import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import DailyCare from '../../../src/pages/DailyCare.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

// Mock navigate to assert button navigations
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

test('header actions: refresh reloads data; buttons navigate and show counts', async () => {
  const user = userEvent.setup()
  // First response: two plants, one needs water and measurement; another only needs measurement
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      {
        uuid: 'a', id: 1, name: 'Aloe', latest_at: '2025-01-01T00:00:00', water_retained_pct: 10, recommended_water_threshold_pct: 30,
      },
      {
        uuid: 'b', id: 2, name: 'Cactus', latest_at: '2025-01-01T00:00:00', water_retained_pct: 90, recommended_water_threshold_pct: 30,
      },
    ]))
  )

  renderPage()
  // Wait for table
  await screen.findByRole('table')

  // Buttons should include counts
  const weightBtn = screen.getByRole('button', { name: /Bulk measurement/ })
  const waterBtn = screen.getByRole('button', { name: /Bulk watering/ })
  expect(weightBtn.textContent).toMatch(/\(2\)/)
  expect(waterBtn.textContent).toMatch(/\(1\)/)

  // Navigate via buttons
  await user.click(weightBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/measurements/bulk/weight')
  mockNavigate.mockClear()
  await user.click(waterBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/measurements/bulk/watering')

  // Now change server response and click refresh to re-load
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'c', id: 3, name: 'New', latest_at: '2999-01-01T00:00:00', water_retained_pct: 90, recommended_water_threshold_pct: 30 },
    ]))
  )
  const refreshBtn = screen.getByRole('button', { name: /refresh/i })
  await user.click(refreshBtn)
  // Empty state now (no tasks due)
  expect(await screen.findByRole('note')).toHaveTextContent(/No tasks for today/i)
})

test('invalid timestamps produce no measurement needed while water threshold still triggers water task', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'x', id: 10, name: 'Ivy', latest_at: 'not-a-date', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ]))
  )
  renderPage()
  await screen.findByRole('table')

  // Expect aria labels to reflect no measurement needed but needs watering
  expect(screen.getByRole('img', { name: 'No measurement needed' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Needs watering' })).toBeInTheDocument()
})
