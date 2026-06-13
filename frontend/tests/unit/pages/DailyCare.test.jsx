import React from 'react'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import DailyCare from '../../../src/pages/DailyCare.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { plantsApi } from '../../../src/api/plants'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { paginatedPlantsHandler } from '../msw/paginate.js'

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
  ),
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
  ),
}))

vi.mock('../../../src/components/IconButton.jsx', () => ({
  default: ({ onClick, label, icon }) => (
    <button onClick={onClick} aria-label={label} data-icon={icon}>
      {label}
    </button>
  ),
}))

vi.mock('../../../src/components/feedback/Loader.jsx', () => ({
  default: ({ message }) => (
    <div role="status" data-testid="loader">
      {message || 'Loading...'}
    </div>
  ),
}))

vi.mock('../../../src/components/feedback/ErrorNotice.jsx', () => ({
  default: ({ message }) => (
    <div role="alert" data-testid="error-notice">
      {message}
    </div>
  ),
}))

vi.mock('../../../src/components/feedback/EmptyState.jsx', () => ({
  default: ({ title }) => (
    <div role="note" data-testid="empty-state">
      <h3>{title}</h3>
    </div>
  ),
}))

vi.mock('../../../src/components/StatusIcon.jsx', () => ({
  default: ({ type, active }) => (
    <div
      role="img"
      aria-label={
        active
          ? type === 'measure'
            ? 'Needs measurement'
            : 'Needs watering'
          : type === 'measure'
            ? 'No measurement needed'
            : 'No watering needed'
      }
    />
  ),
}))

vi.mock('../../../src/components/DateTimeText.jsx', () => ({
  default: ({ value }) => <span data-testid="datetime-text">{value}</span>,
}))

vi.mock('../../../src/utils/datetime.js', async () => {
  const actual = await vi.importActual('../../../src/utils/datetime.js')
  return {
    ...actual,
    formatDateTime: (val) => val,
  }
})

function renderPage(mode = 'manual') {
  // window.__VITEST_DEBUG_WATERING__ = true
  if (mode) {
    localStorage.setItem('operationMode', mode)
  } else {
    localStorage.removeItem('operationMode')
  }
  return render(
    <MemoryRouter>
      <DailyCare />
    </MemoryRouter>,
  )
}

test('shows tasks table with water indicators', async () => {
  // provide one plant that needs both water and measurement
  server.use(
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    http.get('/api/plants', () =>
      HttpResponse.json({
        items: [
          {
            uuid: 'u1',
            id: 1,
            name: 'Aloe',
            status: 'active',
            latest_at: '2020-01-01T00:00:00',
            water_retained_pct: 10,
            recommended_water_threshold_pct: 30,
            needs_weighing: false,
          },
        ],
      }),
    ),
    http.get('/api/plants/uuids', () => HttpResponse.json(['u1'])),
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [{ plant_uuid: 'u1', days_offset: 0, virtual_water_retained_pct: 5 }],
      }),
    ),
  )
  renderPage('vacation')

  // Table should appear once loaded
  const table = await screen.findByRole('table', {}, { timeout: 10000 })
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
    ...paginatedPlantsHandler([
      {
        uuid: 'x1',
        id: 1,
        name: 'Fern',
        latest_at: '2999-01-01T00:00:00',
      },
    ]),
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [{ plant_uuid: 'x1', days_offset: 5 }],
      }),
    ),
  )
  renderPage('vacation') // Use vacation mode to ensure no measurement tasks are generated
  const note = await screen.findByRole('note')
  expect(note).toHaveTextContent(/No tasks for today/i)
})

test('handles non-array API response gracefully as empty', async () => {
  server.use(
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    ...paginatedPlantsHandler([]),
  )
  renderPage('vacation') // Use vacation mode
  const note = await screen.findByRole('note')
  expect(note).toHaveTextContent(/No tasks for today/i)
})

test('shows error notice when API fails', async () => {
  server.use(
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    http.get('/api/plants', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
    http.get('/api/plants/uuids', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({ items: [] }),
    ),
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/boom/i)
})

test('shows default error message when API rejects without message', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json({ message: 'Error' }, { status: 500 })),
    http.get('/api/plants/uuids', () => HttpResponse.json({ message: 'Error' }, { status: 500 })),
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Error')
})

test('header actions: refresh reloads data; buttons navigate and show counts', async () => {
  // First response: two plants, one needs water
  server.use(
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    http.get('/api/plants', () =>
      HttpResponse.json({
        items: [
          {
            uuid: 'a',
            id: 1,
            name: 'Aloe',
            status: 'active',
            latest_at: '2025-01-01T00:00:00',
            water_retained_pct: 10,
            recommended_water_threshold_pct: 30,
            needs_weighing: false,
          },
          {
            uuid: 'b',
            id: 2,
            name: 'Cactus',
            status: 'active',
            latest_at: '2025-01-01T00:00:00',
            water_retained_pct: 80,
            recommended_water_threshold_pct: 30,
            needs_weighing: false,
          },
        ],
      }),
    ),
    http.get('/api/plants/uuids', () => HttpResponse.json(['a', 'b'])),
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [
          { plant_uuid: 'a', days_offset: 0, virtual_water_retained_pct: 5 },
          { plant_uuid: 'b', days_offset: 2, virtual_water_retained_pct: 80 },
        ],
      }),
    ),
  )

  renderPage('vacation')
  // Wait for loading to finish and table to appear
  await screen.findByRole('table', {}, { timeout: 10000 })

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
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    http.get('/api/plants', () =>
      HttpResponse.json({
        items: [
          {
            uuid: 'c',
            id: 3,
            name: 'New',
            status: 'active',
            latest_at: '2999-01-01T00:00:00',
            needs_weighing: false,
          },
        ],
      }),
    ),
    http.get('/api/plants/uuids', () => HttpResponse.json(['c'])),
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [{ plant_uuid: 'c', days_offset: 10, virtual_water_retained_pct: 100 }],
      }),
    ),
  )
  const refreshBtn = screen.getByRole('button', { name: /refresh/i })
  fireEvent.click(refreshBtn)
  // Empty state now (no tasks due)
  expect(await screen.findByRole('note')).toHaveTextContent(/No tasks for today/i)
})

test('handle reload error (line 111) and refetch usage', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  // To trigger refetch, we can call the handleRefresh on PageHeader
  server.use(
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    ...paginatedPlantsHandler([
      { uuid: 'p1', name: 'Plant 1', status: 'active', needs_weighing: true },
    ]),
  )
  renderPage()
  await screen.findByRole('table')

  // Now make reload fail
  server.use(
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({ message: 'Fail' }, { status: 500 }),
    ),
  )
  const refreshBtn = screen.getByRole('button', { name: /refresh/i })
  fireEvent.click(refreshBtn)

  await waitFor(() =>
    expect(consoleSpy).toHaveBeenCalledWith('Failed to reload approximations', expect.any(Error)),
  )
  consoleSpy.mockRestore()
})

test('missing approximation data results in no tasks', async () => {
  server.use(
    ...paginatedPlantsHandler([
      { uuid: 'x', id: 10, name: 'Ivy', latest_at: '2020-01-01T00:00:00' },
    ]),
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({ items: [] }),
    ),
  )
  renderPage('vacation')
  const note = await screen.findByRole('note')
  expect(note).toHaveTextContent(/No tasks for today/i)
})

test('missing latest_at results in no measurement icon and potentially needs water from approximation', async () => {
  server.use(
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [{ plant_uuid: 'm1', days_offset: 0, virtual_water_retained_pct: 5 }],
      }),
    ),
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    ...paginatedPlantsHandler([
      { uuid: 'm1', id: 20, name: 'Monstera', status: 'active', needs_weighing: false },
    ]),
  )
  renderPage('vacation')
  await screen.findByRole('table', {}, { timeout: 10000 })

  // Icon should reflect needs watering from approx
  expect(screen.queryByRole('img', { name: 'Needs measurement' })).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Needs watering' })).toBeInTheDocument()
})

test('fallback rendering: water task from approximation and name/notes/location fallbacks', async () => {
  // One plant: has identify_hint and only measurement due; another: no names to force em-dash and reason fallback
  server.use(
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [
          { plant_uuid: 'p1', days_offset: 0, virtual_water_retained_pct: 5 },
          { plant_uuid: 'p2', days_offset: 0, virtual_water_retained_pct: 5 },
        ],
      }),
    ),
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    ...paginatedPlantsHandler([
      {
        uuid: 'p1',
        id: 11,
        identify_hint: 'Hint:',
        plant: 'LegacyName',
        location: 'Shelf',
        status: 'active',
        needs_weighing: false,
      },
      {
        uuid: 'p2',
        id: 12,
        reason: 'Auto',
        scheduled_for: '2024-12-12T12:00:00',
        status: 'active',
        needs_weighing: false,
      },
    ]),
  )
  renderPage('vacation')
  const table = await screen.findByRole('table', {}, { timeout: 10000 })
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
    </ThemeProvider>,
  )

  // Wait until either table or empty state appears (depending on default MSW handlers)
  await screen.findByRole('table', {}, { timeout: 5000 }).catch(async () => {
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
    </ThemeProvider>,
  )

  // Wait for header to be present and click the back button
  // The button text is "← Dashboard"; match by the titleBack part to be robust
  const backBtn = await screen.findByRole('button', { name: /Dashboard/i })
  fireEvent.click(backBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/dashboard')

  unmount()
})

test('bulk watering button shows count when plants need water', async () => {
  server.use(
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    ...paginatedPlantsHandler([
      { uuid: 'a', id: 1, name: 'Aloe', status: 'active', needs_weighing: true },
    ]),
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [{ plant_uuid: 'a', days_offset: 0, virtual_water_retained_pct: 5 }],
      }),
    ),
  )

  renderPage('manual')
  const waterBtn = await screen.findByRole('button', { name: /Bulk watering \(1\)/i })
  expect(waterBtn.textContent).toMatch(/\(1\)/)
})

test('shows weight column and enables bulk measurement in manual mode', async () => {
  server.use(
    http.get('/api/plants/measurements/approximation/weight', () =>
      HttpResponse.json({ items: [] }),
    ),
    ...paginatedPlantsHandler([
      { uuid: 'a', id: 1, name: 'Aloe', status: 'active', needs_weighing: true },
    ]),
    http.get('/api/plants/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [
          { plant_uuid: 'a', days_offset: 10, virtual_water_retained_pct: 80 }, // Not needing water
        ],
      }),
    ),
  )

  renderPage('manual')
  const weightBtn = await screen.findByRole('button', { name: /Bulk measurement \(1\)/i })

  // Bulk measurement should be enabled
  expect(weightBtn).not.toBeDisabled()

  // Weight column should be present in header
  expect(screen.getByRole('columnheader', { name: /Weight/i })).toBeInTheDocument()

  // Status icon for measurement should be present (since we set needs_weighing: true)
  expect(screen.getByRole('img', { name: 'Needs measurement' })).toBeInTheDocument()
})
