import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import DailyCare from '../../../src/pages/DailyCare.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { plantsApi } from '../../../src/api/plants'
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

test('handles non-array API response gracefully as empty', async () => {
  // Spy to return a non-array; component should treat as [] and show EmptyState
  const spy = vi.spyOn(plantsApi, 'list').mockResolvedValueOnce({})
  renderPage()
  const note = await screen.findByRole('note')
  expect(note).toHaveTextContent(/No tasks for today/i)
  spy.mockRestore()
})

test('shows error notice when API fails', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/boom/i)
})

test("shows default error message when API rejects without message", async () => {
  // Spy on plantsApi.list to reject with an object without message so component uses fallback text
  const spy = vi.spyOn(plantsApi, 'list').mockRejectedValueOnce({})
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent("Failed to load today's tasks")
  spy.mockRestore()
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

test('missing latest_at results in no measurement needed', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'm1', id: 20, name: 'Monstera', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ]))
  )
  renderPage()
  await screen.findByRole('table')
  expect(screen.getByRole('img', { name: 'No measurement needed' })).toBeInTheDocument()
})

test('fallback rendering: no watering needed label and name/notes/location fallbacks', async () => {
  // One plant: has identify_hint and only measurement due; another: no names to force em-dash and reason fallback
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'p1', id: 11, identify_hint: 'Hint:', plant: 'LegacyName', latest_at: '2020-01-01T00:00:00', water_retained_pct: 80, recommended_water_threshold_pct: 30, location: 'Shelf' },
      { uuid: 'p2', id: 12, latest_at: '2020-01-01T00:00:00', water_retained_pct: 80, recommended_water_threshold_pct: 30, reason: 'Auto', scheduled_for: '2024-12-12T12:00:00' },
    ]))
  )
  renderPage()
  const table = await screen.findByRole('table')
  const rows = within(table).getAllByRole('row')
  // Two data rows expected
  const dataRows = rows.slice(1)

  // Row 1: identify_hint prefix + fallback to `plant` when name missing
  expect(within(dataRows[0]).getByText(/Hint:/)).toBeInTheDocument()
  expect(within(dataRows[0]).getByText(/LegacyName/)).toBeInTheDocument()
  // Row 1: No watering needed label (retained 80 > 30)
  expect(within(dataRows[0]).getByRole('img', { name: 'No watering needed' })).toBeInTheDocument()
  // Location shown
  expect(within(dataRows[0]).getByText('Shelf')).toBeInTheDocument()

  // Row 2: name/plant missing -> em dash in the Plant column specifically
  const plantCell = within(dataRows[1]).getAllByRole('cell')[2]
  expect(plantCell).toHaveTextContent('—')
  expect(within(dataRows[1]).getByText('Auto')).toBeInTheDocument()
  // Last updated cell should not be empty (renders DateTimeText for scheduled_for)
  const lastUpdatedCell = within(dataRows[1]).getAllByRole('cell')[5]
  expect(lastUpdatedCell.textContent).not.toBe('')
})

test('unmount runs effect cleanup (improves function coverage)', async () => {
  // Render and wait for initial load to finish
  const { unmount } = render(
    <ThemeProvider>
      <MemoryRouter>
        <DailyCare />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Wait until either table or empty state appears (depending on default MSW handlers)
  await screen.findByRole('table')
    .catch(async () => {
      // if no table, expect an empty state note to be present
      await screen.findByRole('note')
    })

  // Now unmount to execute the useEffect cleanup function
  expect(() => unmount()).not.toThrow()
})

test('clicking back button triggers navigate to dashboard (covers onBack inline)', async () => {
  const { unmount } = render(
    <ThemeProvider>
      <MemoryRouter>
        <DailyCare />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Wait for header to be present and click the back button
  // The button text is "← Dashboard"; match by the titleBack part to be robust
  const backBtn = await screen.findByRole('button', { name: /Dashboard/i })
  await userEvent.click(backBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/dashboard')

  unmount()
})
