import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
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

vi.mock('../../../src/components/DashboardLayout.jsx', () => ({
  default: ({ children, title }) => (
    <div data-testid="mock-dashboard-layout">
      <h1>{title}</h1>
      {children}
    </div>
  )
}))

vi.mock('../../../src/components/PageHeader.jsx', () => ({
  default: ({ onBack, onCreate, onRefresh, title, actions }) => (
    <div data-testid="mock-page-header">
      <h1>{title}</h1>
      <button onClick={onBack}>Dashboard</button>
      {onRefresh && <button onClick={onRefresh}>Refresh</button>}
      {onCreate && <button onClick={onCreate}>Create</button>}
      {actions}
    </div>
  )
}))

vi.mock('../../../src/components/IconButton.jsx', () => ({
  default: ({ onClick, label, icon }) => (
    <button onClick={onClick} aria-label={label} data-icon={icon}>
      {label}
    </button>
  )
}))

vi.mock('../../../src/components/feedback/Loader.jsx', () => ({
  default: ({ message }) => <div role="status" data-testid="loader">{message || 'Loading...'}</div>
}))

vi.mock('../../../src/components/feedback/ErrorNotice.jsx', () => ({
  default: ({ message }) => <div role="alert" data-testid="error-notice">{message}</div>
}))

vi.mock('../../../src/components/feedback/EmptyState.jsx', () => ({
  default: ({ title }) => (
    <div role="note" data-testid="empty-state">
      <h3>{title}</h3>
    </div>
  )
}))

vi.mock('../../../src/components/StatusIcon.jsx', () => ({
  default: ({ type, active }) => <div role="img" aria-label={active ? (type === 'measure' ? 'Needs measurement' : 'Needs watering') : (type === 'measure' ? 'No measurement needed' : 'No watering needed')} />
}))

vi.mock('../../../src/components/DateTimeText.jsx', () => ({
  default: ({ value }) => <span data-testid="datetime-text">{value}</span>
}))

vi.mock('../../../src/utils/datetime.js', async () => {
  const actual = await vi.importActual('../../../src/utils/datetime.js')
  return {
    ...actual,
    formatDateTime: (val) => val
  }
})

function renderPage(mode = 'manual') {
  if (mode) {
    localStorage.setItem('operationMode', mode)
  } else {
    localStorage.removeItem('operationMode')
  }
  return render(
    <MemoryRouter>
      <DailyCare />
    </MemoryRouter>
  )
}

test('shows tasks table with water indicators', async () => {
  // provide one plant that needs both water and measurement
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      {
        uuid: 'u1', id: 1, name: 'Aloe', latest_at: '2020-01-01T00:00:00',
      }
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [
        { plant_uuid: 'u1', days_offset: 0 }
      ]
    }))
  )
  renderPage('vacation') // Use vacation to match original test expectations (no measurement icon)

  // Table should appear once loaded
  const table = await screen.findByRole('table')
  const rows = within(table).getAllByRole('row')
  // header + 1 item
  expect(rows.length).toBe(2)

  // Check accessible names on status icons (role="img")
  // Measurement icon is gone in vacation mode
  expect(screen.queryByRole('img', { name: 'Needs measurement' })).not.toBeInTheDocument()
  expect(await screen.findByRole('img', { name: 'Needs watering' })).toBeInTheDocument()
})

test('renders empty state when no tasks are due', async () => {
  // All plants above water threshold and recently updated (future time) → no tasks
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      {
        uuid: 'x1', id: 1, name: 'Fern', latest_at: '2999-01-01T00:00:00',
      },
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [
        { plant_uuid: 'x1', days_offset: 5 }
      ]
    }))
  )
  renderPage('vacation') // Use vacation mode to ensure no measurement tasks are generated
  const note = await screen.findByRole('note')
  expect(note).toHaveTextContent(/No tasks for today/i)
})

test('handles non-array API response gracefully as empty', async () => {
  // Spy to return a non-array; component should treat as [] and show EmptyState
  const spy = vi.spyOn(plantsApi, 'list').mockResolvedValueOnce({})
  server.use(
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] }))
  )
  renderPage('vacation') // Use vacation mode
  const note = await screen.findByRole('note')
  expect(note).toHaveTextContent(/No tasks for today/i)
  spy.mockRestore()
})

test('shows error notice when API fails', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] }))
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/boom/i)
})

test("shows default error message when API rejects without message", async () => {
  // Spy on plantsApi.list to reject with an object without message so component uses fallback text
  const spy = vi.spyOn(plantsApi, 'list').mockRejectedValueOnce({})
  server.use(
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] }))
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent("Failed to load today's tasks")
  spy.mockRestore()
})

test('header actions: refresh reloads data; buttons navigate and show counts', async () => {
  // First response: two plants, one needs water
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      {
        uuid: 'a', id: 1, name: 'Aloe', latest_at: '2025-01-01T00:00:00',
      },
      {
        uuid: 'b', id: 2, name: 'Cactus', latest_at: '2025-01-01T00:00:00',
      },
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [
        { plant_uuid: 'a', days_offset: 0 },
        { plant_uuid: 'b', days_offset: 2 }
      ]
    }))
  )

  renderPage('vacation')
  // Wait for table
  await screen.findByRole('table')

  // Buttons: Bulk measurement should be disabled and no count
  const weightBtn = screen.getByRole('button', { name: /Bulk measurement/ })
  const waterBtn = screen.getByRole('button', { name: /Bulk watering/ })
  expect(weightBtn).toBeDisabled()
  expect(weightBtn.textContent).not.toMatch(/\(/)
  expect(waterBtn.textContent).toMatch(/\(1\)/)

  // Navigate via water button
  fireEvent.click(waterBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/measurements/bulk/watering')

  // Now change server response and click refresh to re-load
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'c', id: 3, name: 'New', latest_at: '2999-01-01T00:00:00' },
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [
        { plant_uuid: 'c', days_offset: 10 }
      ]
    }))
  )
  const refreshBtn = screen.getByRole('button', { name: /refresh/i })
  fireEvent.click(refreshBtn)
  // Empty state now (no tasks due)
  expect(await screen.findByRole('note')).toHaveTextContent(/No tasks for today/i)
})

test('missing approximation data results in no tasks', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'x', id: 10, name: 'Ivy', latest_at: '2020-01-01T00:00:00' },
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] }))
  )
  renderPage('vacation')
  const note = await screen.findByRole('note')
  expect(note).toHaveTextContent(/No tasks for today/i)
})

test('missing latest_at results in no measurement icon and potentially needs water from approximation', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'm1', id: 20, name: 'Monstera' },
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [
        { plant_uuid: 'm1', days_offset: 0 }
      ]
    }))
  )
  renderPage('vacation')
  await screen.findByRole('table')

  // Icon should reflect needs watering from approx
  expect(screen.queryByRole('img', { name: 'Needs measurement' })).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Needs watering' })).toBeInTheDocument()
})

test('fallback rendering: water task from approximation and name/notes/location fallbacks', async () => {
  // One plant: has identify_hint and only measurement due; another: no names to force em-dash and reason fallback
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'p1', id: 11, identify_hint: 'Hint:', plant: 'LegacyName', location: 'Shelf' },
      { uuid: 'p2', id: 12, reason: 'Auto', scheduled_for: '2024-12-12T12:00:00' },
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [
        { plant_uuid: 'p1', days_offset: 0 },
        { plant_uuid: 'p2', days_offset: 0 }
      ]
    }))
  )
  renderPage('vacation')
  const table = await screen.findByRole('table')
  const rows = within(table).getAllByRole('row')
  // Two data rows expected
  const dataRows = rows.slice(1)

  // Row 1: identify_hint prefix + fallback to `plant` when name missing
  expect(within(dataRows[0]).getByText(/Hint:/)).toBeInTheDocument()
  expect(within(dataRows[0]).getByText(/LegacyName/)).toBeInTheDocument()
  // Row 1: Needs watering label from approximation
  expect(within(dataRows[0]).getByRole('img', { name: 'Needs watering' })).toBeInTheDocument()
  // Location shown
  expect(within(dataRows[0]).getByText('Shelf')).toBeInTheDocument()

  // Row 2: name/plant missing -> em dash in the Plant column specifically
  // After removing Weight column (in vacation mode), Water is col 0, Plant is col 1
  const plantCell = within(dataRows[1]).getAllByRole('cell')[1]
  expect(plantCell).toHaveTextContent('—')
  expect(within(dataRows[1]).getByText('Auto')).toBeInTheDocument()
  // Last updated cell should not be empty (renders DateTimeText for scheduled_for)
  // Water(0), Plant(1), Notes(2), Location(3), Last updated(4)
  const lastUpdatedCell = within(dataRows[1]).getAllByRole('cell')[4]
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
  fireEvent.click(backBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/dashboard')

  unmount()
})

test('bulk watering button does not show count when not in vacation mode', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'a', id: 1, name: 'Aloe', needs_weighing: true }
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [
        { plant_uuid: 'a', days_offset: 0 }
      ]
    }))
  )

  renderPage('manual')
  await screen.findByRole('table')

  const waterBtn = screen.getByRole('button', { name: /Bulk watering/ })
  expect(waterBtn.textContent).not.toMatch(/\(/)
  expect(waterBtn.textContent).toBe('Bulk watering')
})

test('shows weight column and enables bulk measurement in manual mode', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'a', id: 1, name: 'Aloe', needs_weighing: true }
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [
        { plant_uuid: 'a', days_offset: 10 } // Not needing water
      ]
    }))
  )

  renderPage('manual')
  await screen.findByRole('table')

  // Bulk measurement should be enabled
  const weightBtn = screen.getByRole('button', { name: /Bulk measurement/ })
  expect(weightBtn).not.toBeDisabled()
  
  // Weight column should be present in header
  expect(screen.getByRole('columnheader', { name: /Weight/i })).toBeInTheDocument()

  // Status icon for measurement should be present (since we set needsMeasure to operationMode !== 'vacation')
  expect(screen.getByRole('img', { name: 'Needs measurement' })).toBeInTheDocument()
})
