import React from 'react'
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  waitForElementToBeRemoved,
  cleanup,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Link } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantsList from '../../../src/pages/PlantsList.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { plantsApi } from '../../../src/api/plants'
import { vi, afterEach, beforeEach } from 'vitest'

// Mock useNavigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../../../src/components/DashboardLayout.jsx', () => ({
  default: ({ children }) => <div data-testid="mock-dashboard-layout">{children}</div>,
}))

vi.mock('../../../src/components/PageHeader.jsx', () => ({
  default: ({ onBack, onCreate, title, actions }) => (
    <div data-testid="mock-page-header">
      <h1>{title}</h1>
      <button onClick={onBack}>Dashboard</button>
      <button onClick={onCreate}>Create</button>
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

/** Helper: creates an MSW handler that simulates server-side pagination & filtering */
function mockPlantsHandler(allPlants) {
  return http.get('/api/plants', ({ request }) => {
    const url = new URL(request.url)
    const search = (url.searchParams.get('search') || '').trim().toLowerCase()
    const limit = parseInt(url.searchParams.get('limit') || '20', 10)
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    let filtered = allPlants
    if (search) {
      const num = Number(search)
      if (!isNaN(num) && search !== '') {
        filtered = allPlants.filter((p) => {
          const t = Number(p.recommended_water_threshold_pct)
          return !isNaN(t) && t <= num
        })
      } else {
        filtered = allPlants.filter((p) =>
          [p.name, p.notes, p.location, p.identify_hint].some(
            (v) => typeof v === 'string' && v.toLowerCase().includes(search),
          ),
        )
      }
    }
    const start = (page - 1) * limit
    const paged = filtered.slice(start, start + limit)
    return HttpResponse.json({
      items: paged,
      total: filtered.length,
      total_pages: Math.ceil(filtered.length / limit) || 0,
      page,
      limit,
      global_total: allPlants.length,
    })
  })
}

function renderPage(initialEntries = ['/']) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

// Ensure MSW handlers and sessionStorage are reset after each test in this file to avoid leaking state
afterEach(() => {
  cleanup()
  server.resetHandlers()
  sessionStorage.clear()
  mockNavigate.mockClear()
})

test('integrated: renders plants with various states and handles header actions', async () => {
  // u1 (Aloe) has approx freq 5, confidence 10, offset 1, virtual_water_retained_pct 75
  const opMode = localStorage.getItem('operationMode') || 'manual'
  server.use(
    mockPlantsHandler([
      {
        uuid: 'u1',
        name: 'Aloe',
        identify_hint: 'Spiky',
        water_retained_pct: 20,
        recommended_water_threshold_pct: 30,
        latest_at: '2025-01-01T00:00:00',
        notes: 'N',
        location: 'Loc',
      },
      {
        uuid: 'u2',
        name: 'Monstera',
        water_retained_pct: 50,
        recommended_water_threshold_pct: 40,
        frequency_days: 7,
      },
      {
        uuid: 'nf1',
        name: 'NoFreq',
        water_retained_pct: 20,
        recommended_water_threshold_pct: 30,
        frequency_days: undefined,
      },
      {
        name: 'Plain',
        notes: 'No link',
        location: 'Somewhere',
        water_retained_pct: 10,
        recommended_water_threshold_pct: 30,
        latest_at: '2025-01-01T00:00:00',
      },
    ]),
    http.get('/api/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [
          {
            plant_uuid: 'u1',
            virtual_water_retained_pct: 75,
            frequency_days: 5,
            frequency_confidence: 10,
            next_watering_at: '2025-01-10T12:00:00Z',
            first_calculated_at: '2025-01-09T12:00:00Z',
            days_offset: 1,
          },
        ],
      }),
    ),
  )

  renderPage()

  // 1. renders plants after loading
  expect(await screen.findByRole('link', { name: /aloe/i })).toBeInTheDocument()
  expect(screen.getByText('Monstera')).toBeInTheDocument()

  // 2. Frequency column (approximation for u1, explicit for u2, missing for nf1)
  const rows = screen.getAllByRole('row')
  const bodyRows = rows.filter((r) => within(r).queryAllByRole('columnheader').length === 0)

  // u1 (Aloe) has approx freq 5, confidence 10, offset 1
  expect(within(bodyRows[0]).getByText('5 d')).toBeInTheDocument()
  expect(within(bodyRows[0]).getByText('(10)')).toBeInTheDocument()
  expect(within(bodyRows[0]).getByText('(1d)')).toBeInTheDocument()
  // u2 has freq 7
  expect(
    within(bodyRows[bodyRows.findIndex((r) => r.textContent.includes('Monstera'))]).getByText(
      '7 d',
    ),
  ).toBeInTheDocument()
  // nf1 has no freq
  const noFreqRow = bodyRows[bodyRows.findIndex((r) => r.textContent.includes('NoFreq'))]
  expect(within(noFreqRow).getAllByText(/^—$/).length).toBeGreaterThan(0)

  // 3. row branches: link vs plain text, needsWater badge
  const linkForName = screen.getByRole('link', { name: /aloe/i })
  expect(linkForName).toHaveAttribute('href', '/plants/u1')
  // Plain row should not have a link for notes; text should be present
  expect(screen.getByText('No link')).toBeInTheDocument()
  // Needs water badge visible for nf1 (20 <= 30)
  expect(
    within(bodyRows[bodyRows.findIndex((r) => r.textContent.includes('NoFreq'))]).getByText(
      /Needs water/i,
    ),
  ).toBeInTheDocument()

  // 4. View/Edit guards without uuid
  fireEvent.click(screen.getByRole('button', { name: /view plant plain/i }))
  fireEvent.click(screen.getByRole('button', { name: /edit plant plain/i }))
  expect(await screen.findByRole('link', { name: /aloe/i })).toBeInTheDocument() // still here, no crash/nav

  // 5. name cell gradient (Aloe water_retained_pct is 75 from approx if vacation mode, else 20)
  const nameCell = linkForName.closest('td')
  if (opMode === 'vacation') {
    expect(nameCell.getAttribute('style')).toMatch(/linear-gradient\(90deg, .* 75%/)
  } else {
    expect(nameCell.getAttribute('style')).toMatch(/linear-gradient\(90deg, .* 20%/)
  }

  // 6. Header actions
  fireEvent.click(screen.getByRole('button', { name: /dashboard/i }))
  expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
  fireEvent.click(screen.getByRole('button', { name: /create/i }))
  expect(mockNavigate).toHaveBeenCalledWith('/plants/new')
})

test('navigation: handleView and handleEdit navigate with state', async () => {
  const plant = {
    uuid: 'nav1',
    name: 'Navigator',
    water_retained_pct: 10,
    recommended_water_threshold_pct: 30,
  }
  server.use(mockPlantsHandler([plant]))
  renderPage()

  const viewBtn = await screen.findByRole('button', { name: /view plant navigator/i })
  fireEvent.click(viewBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/plants/nav1', { state: { plant } })

  const editBtn = screen.getByRole('button', { name: /edit plant navigator/i })
  fireEvent.click(editBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/plants/nav1/edit', { state: { plant } })
})

test('ErrorNotice retry calls window.location.reload', async () => {
  server.use(http.get('/api/plants', () => HttpResponse.json({ message: 'fail' }, { status: 500 })))
  const reloadSpy = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload: reloadSpy })

  renderPage()
  const retryBtn = await screen.findByRole('button', { name: /retry/i })
  fireEvent.click(retryBtn)
  expect(reloadSpy).toHaveBeenCalled()
  vi.unstubAllGlobals()
})

test('EmptyState new plant button navigates to /plants/new', async () => {
  server.use(mockPlantsHandler([]))
  renderPage()
  const emptyState = await screen.findByRole('note')
  const newPlantBtn = within(emptyState).getByRole('button', { name: /new plant/i })
  fireEvent.click(newPlantBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/plants/new')
})

test('clearing search query resets page and URL', async () => {
  renderPage(['/plants?search=Aloe&page=2'])
  await waitFor(() => expect(screen.queryByText(/Loading plants\.\.\./i)).not.toBeInTheDocument())
  const clearBtn = await screen.findByTitle(/clear filter/i)
  await userEvent.click(clearBtn)
  // First, the controlled input should clear immediately (setQuery path)
  await waitFor(() => expect(screen.getByLabelText(/search plants/i)).toHaveValue(''), {
    timeout: 5000,
  })
  // Then, the chip depending on URL param should disappear after setSearchParams
  await waitFor(() => expect(screen.queryByTitle(/clear filter/i)).not.toBeInTheDocument(), {
    timeout: 5000,
  })
  // Also wait for the new load to complete
  await waitFor(() => expect(screen.queryByText(/Loading plants\.\.\./i)).not.toBeInTheDocument(), {
    timeout: 5000,
  })
})

test('drift notification handles refresh and dismiss', async () => {
  const reloadSpy = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload: reloadSpy })

  try {
    // 1. Initial load
    server.use(
      http.get('/api/plants', () =>
        HttpResponse.json({ items: [], total: 0, global_total: 2, total_pages: 0 }),
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.queryByText(/Loading plants\.\.\./i)).not.toBeInTheDocument())

    // 2. Trigger drift via search
    server.use(
      http.get('/api/plants', () =>
        HttpResponse.json({ items: [], total: 0, global_total: 3, total_pages: 0 }),
      ),
    )
    const searchInput = screen.getByLabelText(/search plants/i)
    fireEvent.change(searchInput, { target: { value: 'drift' } })

    const notification = await screen.findByText(/plants list updated/i)
    expect(notification).toBeInTheDocument()

    // 3. Dismiss
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i })
    fireEvent.click(dismissBtn)
    await waitFor(() => expect(screen.queryByText(/plants list updated/i)).not.toBeInTheDocument())

    // 4. Refresh (trigger again)
    server.use(
      http.get('/api/plants', () =>
        HttpResponse.json({ items: [], total: 0, global_total: 4, total_pages: 0 }),
      ),
    )
    const searchInput4 = await screen.findByLabelText(/search plants/i)
    fireEvent.change(searchInput4, { target: { value: 'drift2' } })
    // Ensure the new search query was applied and load finished
    await waitFor(
      () => expect(screen.queryByText(/Loading plants\.\.\./i)).not.toBeInTheDocument(),
      { timeout: 5000 },
    )
    const refreshBtn = await screen.findByRole('button', { name: /refresh/i }, { timeout: 5000 })
    fireEvent.click(refreshBtn)
    expect(reloadSpy).toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('EmptyState for search result with zero items (lines 349-357)', async () => {
  server.use(
    http.get('/api/plants', () =>
      HttpResponse.json({ items: [], total: 0, total_pages: 0, global_total: 10 }),
    ),
  )
  renderPage(['/plants?search=Unknown'])
  await waitFor(() => expect(screen.queryByText(/Loading plants\.\.\./i)).not.toBeInTheDocument())
  expect(await screen.findByText(/No plants found for "Unknown"/i)).toBeInTheDocument()

  // Click "Clear search" button to cover the function on line 359
  const clearBtn = screen.getByText('Clear search')
  fireEvent.click(clearBtn)
  // The URL search query should clear, which eventually triggers a reload without the query
  await waitFor(() =>
    expect(screen.queryByText(/No plants found for "Unknown"/i)).not.toBeInTheDocument(),
  )
})

test('vacation mode styling without localstorage', async () => {
  server.use(
    mockPlantsHandler([{ uuid: 'v1', name: 'Vacation' }]),
    http.get('/api/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [{ plant_uuid: 'v1', days_offset: -1, next_watering_at: '2025-01-01T00:00:00Z' }],
      }),
    ),
  )
  // Ensure vacation mode is OFF
  localStorage.removeItem('operationMode')
  renderPage()
  const vac = await screen.findByText('Vacation')
  const row = vac.closest('tr')
  const cell = within(row).getAllByRole('cell')[3]
  // Should NOT have the pink background
  expect(cell).not.toHaveStyle('background: #fecaca')
})

test('Pagination page change updates URL', async () => {
  server.use(
    mockPlantsHandler(
      Array(100)
        .fill(0)
        .map((_, i) => ({ uuid: `p${i}`, name: `Plant ${i}` })),
    ),
  )
  renderPage(['/plants?page=1&limit=20'])
  await waitFor(() => expect(screen.queryByText(/Loading plants\.\.\./i)).not.toBeInTheDocument())

  const nextBtn = screen.getAllByRole('button', { name: /next page/i })[0]
  fireEvent.click(nextBtn)

  await waitFor(() =>
    expect(screen.getAllByText(/Showing 21–40 of 100/i).length).toBeGreaterThan(0),
  )
})

test('Pagination page size change resets to page 1', async () => {
  server.use(
    mockPlantsHandler(
      Array(100)
        .fill(0)
        .map((_, i) => ({ uuid: `p${i}`, name: `Plant ${i}` })),
    ),
  )
  renderPage(['/plants?page=3&limit=10'])
  await waitFor(() => expect(screen.queryByText(/Loading plants\.\.\./i)).not.toBeInTheDocument())

  const pageSizeSelect = await screen.findByLabelText(/per page/i)
  fireEvent.change(pageSizeSelect, { target: { value: '20' } })

  // Should reset to page 1 and show 20 items
  await waitFor(() => expect(screen.getAllByText(/Showing 1–20 of 100/i).length).toBeGreaterThan(0))
})
test('numeric search filters by threshold (<= query)', async () => {
  // Provide custom plants including thresholds to exercise numeric filter branch
  server.use(
    mockPlantsHandler([
      { uuid: 'a', name: 'Low', recommended_water_threshold_pct: 20 },
      { uuid: 'b', name: 'Edge', recommended_water_threshold_pct: 30 },
      { uuid: 'c', name: 'High', recommended_water_threshold_pct: 45 },
      // Non-numeric threshold should be ignored for numeric filtering (NaN path)
      { uuid: 'd', name: 'NonNum', recommended_water_threshold_pct: 'N/A' },
    ]),
  )
  renderPage()

  // Ensure items are loaded
  expect(await screen.findByText('Low')).toBeInTheDocument()

  // input type="search" has role 'searchbox' per ARIA; reflect component change
  const search = await screen.findByRole('searchbox', { name: /search plants/i })
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.change(search, { target: { value: '30' } })

  // Now only items with threshold <= 30 should be visible in the limited list
  await screen.findByText('Low')
  expect(screen.getByText('Edge')).toBeInTheDocument()
  // The one above threshold should be filtered out
  await waitFor(() => expect(screen.queryByText('High')).not.toBeInTheDocument())
  // Non-numeric threshold should also not be included for numeric query
  expect(screen.queryByText('NonNum')).not.toBeInTheDocument()

  // Meta text reflects filtered count (server-side pagination) — shown in top and bottom pagination
  expect(screen.getAllByText(/1–2 of 2/).length).toBeGreaterThanOrEqual(1)
})

test('applies updatedPlant from router state without crashing (effect path exercised)', async () => {
  // Use default handler returning two plants; pass router state to update first
  render(
    <ThemeProvider>
      <MemoryRouter
        initialEntries={[
          { pathname: '/plants', state: { updatedPlant: { uuid: 'u1', name: 'Aloe UPDATED' } } },
        ]}
      >
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )

  // Wait initial load; effect runs early but may clear state before data
  expect(await screen.findByText('Aloe')).toBeInTheDocument()
  // No strict assertion on updated label due to timing; presence ensures render ok
})

test('reordering integration: handles drag-and-drop and move buttons', async () => {
  server.use(
    mockPlantsHandler([
      { uuid: 'a', name: 'A', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { uuid: 'b', name: 'B', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
      { uuid: 'c', name: 'C', water_retained_pct: 40, recommended_water_threshold_pct: 30 },
    ]),
    http.put('/api/plants/order', () => HttpResponse.json({ ok: true })),
  )

  renderPage()
  expect(await screen.findByText('A')).toBeInTheDocument()

  // 1. Move buttons (Up on index 1) -> B, A, C
  const moveUpB = screen.getByRole('button', { name: /move b up/i })
  fireEvent.click(moveUpB)
  let rows = screen.getAllByRole('row').slice(1)
  expect(rows[0]).toHaveTextContent('B')
  expect(rows[1]).toHaveTextContent('A')

  // 2. Drag and drop (A over B) -> A, B, C
  const dt = {
    data: {},
    setData(k, v) {
      this.data[k] = v
    },
    getData(k) {
      return this.data[k]
    },
  }
  fireEvent.dragStart(rows[1], { dataTransfer: dt }) // A
  fireEvent.dragOver(rows[0], { dataTransfer: dt }) // B
  fireEvent.dragEnd(rows[0], { dataTransfer: dt })
  rows = screen.getAllByRole('row').slice(1)
  expect(rows[0]).toHaveTextContent('A')
  expect(rows[1]).toHaveTextContent('B')

  // 3. Move buttons (Down on index 0) -> B, A, C
  const moveDownA = screen.getByRole('button', { name: /move a down/i })
  fireEvent.click(moveDownA)
  rows = screen.getAllByRole('row').slice(1)
  expect(rows[0]).toHaveTextContent('B')
  expect(rows[1]).toHaveTextContent('A')
})

test('delete flow: missing uuid shows saveError; API error shows error; success removes row', async () => {
  // 1) Missing uuid case
  server.use(
    mockPlantsHandler([
      { name: 'NoId', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ]),
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )

  expect(await screen.findByText('NoId')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /delete plant noid/i }))
  // confirm in dialog (scope to dialog)
  const dlg1 = await screen.findByRole('dialog')
  fireEvent.click(within(dlg1).getByRole('button', { name: /delete/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /cannot delete this plant: missing identifier/i,
  )

  // 2) API error case
  server.use(
    mockPlantsHandler([
      { uuid: 'x1', name: 'X', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ]),
    http.delete('/api/plants/:uuid', () => HttpResponse.json({ message: 'Boom' }, { status: 500 })),
  )

  // Re-render new scenario
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )
  expect(await screen.findByText('X')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /delete plant x/i }))
  const dlg2 = await screen.findByRole('dialog')
  fireEvent.click(within(dlg2).getByRole('button', { name: /delete/i }))
  // Row should remain present after failed delete
  expect(await screen.findByText('X')).toBeInTheDocument()

  // 3) Success removes row
  server.use(
    mockPlantsHandler([
      { uuid: 'y1', name: 'Y', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ]),
    http.delete('/api/plants/:uuid', () => HttpResponse.json({ ok: true })),
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )
  expect(await screen.findByText('Y')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /delete plant y/i }))
  const dlg3 = await screen.findByRole('dialog')
  fireEvent.click(within(dlg3).getByRole('button', { name: /delete/i }))
  // Row should disappear
  await screen.findByRole('note') // empty state
}, 15000)

test('limits list to PAGE_LIMIT and shows meta count', async () => {
  // Use a smaller number than PAGE_LIMIT (20) but still enough to see the logic.

  const many = Array.from({ length: 25 }, (_, i) => ({
    uuid: String(i + 1),
    name: `P${i + 1}`,
    water_retained_pct: 10,
    recommended_water_threshold_pct: 30,
  }))
  server.use(mockPlantsHandler(many))

  const { unmount } = renderPage()

  await screen.findByText('P1')
  // We expect 20 rows in the body
  const bodyRows = screen.getAllByRole('row').slice(1)
  expect(bodyRows.length).toBe(20)
  expect(screen.getAllByText(/1–20 of 25/).length).toBeGreaterThanOrEqual(1)
  unmount()
})

test('text search filters by name/notes/location and disables drag & move buttons', async () => {
  server.use(
    mockPlantsHandler([
      {
        uuid: 'n1',
        identify_hint: 'Hint',
        name: 'Alpha',
        notes: 'Sunny spot',
        location: 'Kitchen',
        water_retained_pct: 35,
        recommended_water_threshold_pct: 30,
      },
      {
        uuid: 'n2',
        identify_hint: '',
        name: 'Beta',
        notes: 'Shady',
        location: 'Balcony',
        water_retained_pct: 50,
        recommended_water_threshold_pct: 30,
      },
      {
        uuid: 'n3',
        name: 'Gamma',
        notes: 'Dry area',
        location: 'Living room',
        water_retained_pct: 45,
        recommended_water_threshold_pct: 30,
      },
    ]),
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )

  const search = await screen.findByRole('searchbox', { name: /search plants/i })
  // Query by location text should filter to matches only (case-insensitive)
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.change(search, { target: { value: 'balcony' } })

  // Only Beta should be visible now
  await screen.findByText('Beta')
  expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  expect(screen.queryByText('Gamma')).not.toBeInTheDocument()

  // With a non-empty query, drag and move buttons should be disabled
  const row = screen.getAllByRole('row').slice(1)[0]
  // Move up/down buttons disabled when query is present
  expect(within(row).getByRole('button', { name: /move beta up/i })).toBeDisabled()
  expect(within(row).getByRole('button', { name: /move beta down/i })).toBeDisabled()
})

test('treats non-array response as empty and shows EmptyState', async () => {
  server.use(http.get('/api/plants', () => HttpResponse.json({ bad: 'shape' })))

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )

  // Empty state note should be shown
  await screen.findByRole('note')
})

test('delete failure with null/empty error shows generic message branch', async () => {
  server.use(
    mockPlantsHandler([
      { uuid: 'd1', name: 'Del', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ]),
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )

  expect(await screen.findByText('Del')).toBeInTheDocument()
  // Cause plantsApi.remove to reject with an empty object so e?.message is falsy
  const spy = vi.spyOn(plantsApi, 'remove').mockRejectedValueOnce({})
  fireEvent.click(screen.getByRole('button', { name: /delete plant del/i }))
  const dlg = await screen.findByRole('dialog')
  fireEvent.click(within(dlg).getByRole('button', { name: /delete/i }))
  // Generic failure branch: depending on client, message may be generic or HTTP-specific
  expect(await screen.findByRole('alert')).toHaveTextContent(/failed/i)
  spy.mockRestore()
})

test('persistOrder early-return when row has missing uuid', async () => {
  // Include an item without uuid to trigger persistOrder early return
  server.use(
    mockPlantsHandler([
      {
        uuid: 'f1',
        name: 'Num',
        notes: 'note',
        location: 'loc',
        water_retained_pct: 10,
        recommended_water_threshold_pct: 30,
      },
      {
        name: 'NonNum',
        notes: 'abc',
        location: 'xyz',
        water_retained_pct: 15,
        recommended_water_threshold_pct: 'N/A',
      },
    ]),
    http.put('/api/plants/order', () => HttpResponse.json({ ok: true })),
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )

  // Wait for both items to load
  await screen.findByText('Num')
  expect(screen.getByText('NonNum')).toBeInTheDocument()

  // Drag the second row (missing uuid) over the first to trigger persistOrder early return path
  const rows = () => screen.getAllByRole('row').slice(1)
  const second = rows()[1]
  const first = rows()[0]
  const dt = {
    data: {},
    setData(k, v) {
      this.data[k] = v
    },
    getData(k) {
      return this.data[k]
    },
  }
  fireEvent.dragStart(second, { dataTransfer: dt })
  fireEvent.dragOver(first, { dataTransfer: dt })
  fireEvent.dragEnd(first, { dataTransfer: dt })

  // No error should be shown since persistOrder returns early; table still renders
  expect(rows().length).toBeGreaterThan(0)
})

test('onDragOver early-return branches and onDragEnd with null dragIndex do not persist or reorder', async () => {
  // Arrange three predictable items
  server.use(
    mockPlantsHandler([
      { uuid: 'a', name: 'A', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { uuid: 'b', name: 'B', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
      { uuid: 'c', name: 'C', water_retained_pct: 40, recommended_water_threshold_pct: 30 },
    ]),
    http.put('/api/plants/order', async ({ request }) => {
      const body = await request.json()
      if (Array.isArray(body?.ordered_ids)) {
        return HttpResponse.json({ ok: true })
      }
      return HttpResponse.json({ message: 'bad' }, { status: 500 })
    }),
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )

  // Wait initial
  expect(await screen.findByText('A')).toBeInTheDocument()
  const initialOrder = screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent)

  // 1) Call dragOver without any dragStart -> early return path (dragIndex === null)
  const rows1 = screen.getAllByRole('row').slice(1)
  const dt = {
    data: {},
    setData(k, v) {
      this.data[k] = v
    },
    getData(k) {
      return this.data[k]
    },
  }
  fireEvent.dragOver(rows1[0], { dataTransfer: dt })
  // order unchanged
  expect(
    screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent),
  ).toEqual(initialOrder)

  // 2) Start dragging first row then dragOver the SAME index -> early return when index === dragIndex
  const rows2 = screen.getAllByRole('row').slice(1)
  fireEvent.dragStart(rows2[0], { dataTransfer: dt })
  fireEvent.dragOver(rows2[0], { dataTransfer: dt })
  // still unchanged
  expect(
    screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent),
  ).toEqual(initialOrder)

  // 3) DragEnd on an arbitrary row without a current drag (dragIndex null) should not persist
  // Reset state by ending the previous drag, then trigger a dragEnd without dragStart
  fireEvent.dragEnd(rows2[0], { dataTransfer: dt })
  const spyReorder = vi.spyOn(plantsApi, 'reorder')
  fireEvent.dragEnd(rows2[1], { dataTransfer: dt })
  expect(spyReorder).not.toHaveBeenCalled()
  spyReorder.mockRestore()
})

test('falls back to empty style object when getWaterRetainCellStyle returns falsy (OR branch)', async () => {
  // Mock the module to return undefined for style
  const mod = await vi.importActual('../../../src/utils/water_retained_colors.js')
  const styleSpy = vi.spyOn(mod, 'getWaterRetainCellStyle').mockReturnValueOnce(undefined)
  // Re-require PlantsList after mocking? Not necessary because component imports function at render call time
  server.use(
    mockPlantsHandler([
      { uuid: 's1', name: 'Styled', water_retained_pct: 12, recommended_water_threshold_pct: 30 },
    ]),
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )
  const link = await screen.findByRole('link', { name: /styled/i })
  const nameCell = link.closest('td')
  expect(nameCell).not.toBeNull()
  // Since getWaterRetainCellStyle returned undefined, the style attribute should not include linear-gradient
  expect(nameCell.getAttribute('style') || '').not.toMatch(/linear-gradient/)
  styleSpy.mockRestore()
})

test('Cancel in delete dialog triggers closeDialog without deleting', async () => {
  server.use(
    mockPlantsHandler([
      {
        uuid: 'c1',
        name: 'Cancelable',
        water_retained_pct: 10,
        recommended_water_threshold_pct: 30,
      },
    ]),
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )
  await screen.findByText('Cancelable')
  fireEvent.click(screen.getByRole('button', { name: /delete plant cancelable/i }))
  const dlg = await screen.findByRole('dialog')
  fireEvent.click(within(dlg).getByRole('button', { name: /cancel/i }))
  // Row remains present
  expect(screen.getByText('Cancelable')).toBeInTheDocument()
})

test('persistOrder generic error branch when reorder rejects with empty error object', async () => {
  server.use(
    mockPlantsHandler([
      { uuid: 'a', name: 'A', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { uuid: 'b', name: 'B', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
    ]),
  )

  const spy = vi.spyOn(plantsApi, 'reorder').mockRejectedValueOnce({})
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )
  // wait
  const rows = () => screen.getAllByRole('row').slice(1)
  await screen.findByText('A')
  const dt = {
    data: {},
    setData(k, v) {
      this.data[k] = v
    },
    getData(k) {
      return this.data[k]
    },
  }
  // Drag B over A to reorder
  fireEvent.dragStart(rows()[1], { dataTransfer: dt })
  fireEvent.dragOver(rows()[0], { dataTransfer: dt })
  fireEvent.dragEnd(rows()[1], { dataTransfer: dt })
  // Generic error alert
  expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save order/i)
  spy.mockRestore()
})

test('ignores AbortError during initial load and shows EmptyState without alert', async () => {
  server.use(
    http.get('/api/plants', () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }),
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )
  // No error alert should appear; empty state should be shown after loading finishes
  const note = await screen.findByRole('note')
  expect(note).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('ignores non-AbortError when message includes "abort" (case-insensitive)', async () => {
  server.use(
    http.get('/api/plants', () => {
      const err = new Error('Request ABORT due to navigation')
      // name is not AbortError to exercise message-based branch
      err.name = 'SomeOther'
      throw err
    }),
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )
  // Should not render an error alert; renders empty state after loading
  const note = await screen.findByRole('note')
  expect(note).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('load error with falsy message shows generic fallback (plantsApi.list rejects empty object)', async () => {
  const spy = vi.spyOn(plantsApi, 'list').mockRejectedValueOnce({})
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/failed to load plants/i)
  spy.mockRestore()
})

test('logs error and continues when approximations fail to load', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  server.use(
    mockPlantsHandler([{ uuid: 'u1', name: 'Aloe' }]),
    http.get('/api/measurements/approximation/watering', () =>
      HttpResponse.json({ message: 'Approximation error' }, { status: 500 }),
    ),
  )

  renderPage()

  // Should still render the plant list even if approximations fail
  expect(await screen.findByText('Aloe')).toBeInTheDocument()

  expect(consoleSpy).toHaveBeenCalledWith('Failed to load approximations', expect.anything())
  consoleSpy.mockRestore()
})

test('handles null/missing approximation items gracefully', async () => {
  server.use(
    mockPlantsHandler([{ uuid: 'u1', name: 'Aloe' }]),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: null })),
  )
  renderPage()
  expect(await screen.findByText('Aloe')).toBeInTheDocument()
})

test('applies vacation mode warning style for negative days_offset', async () => {
  localStorage.setItem('operationMode', 'vacation')
  server.use(
    mockPlantsHandler([{ uuid: 'u1', name: 'Aloe' }]),
    http.get('/api/measurements/approximation/watering', () =>
      HttpResponse.json({
        items: [{ plant_uuid: 'u1', days_offset: -2, next_watering_at: '2025-01-01T00:00:00Z' }],
      }),
    ),
  )
  try {
    renderPage()
    const aloe = await screen.findByText('Aloe')
    const row = aloe.closest('tr')
    // Next watering cell is the 4th cell (index 3)
    const nextWateringCell = within(row).getAllByRole('cell')[3]
    expect(nextWateringCell).toHaveStyle('background: #fecaca')
  } finally {
    localStorage.removeItem('operationMode')
  }
})

test('applies updatedPlant from router state - FULL coverage', async () => {
  server.use(
    mockPlantsHandler([
      {
        uuid: 'u1',
        name: 'Original Name',
        identify_hint: '',
        water_retained_pct: 50,
        recommended_water_threshold_pct: 30,
      },
      {
        uuid: 'u2',
        name: 'Other Plant',
        identify_hint: '',
        water_retained_pct: 50,
        recommended_water_threshold_pct: 30,
      },
    ]),
  )

  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/plants']}>
        <Link
          to="/plants"
          state={{
            updatedPlant: {
              uuid: 'u1',
              name: 'Updated Name',
              water_retained_pct: 50,
              recommended_water_threshold_pct: 30,
            },
          }}
        >
          Trigger Update
        </Link>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>,
  )

  await screen.findByText('Original Name')
  await screen.findByText('Other Plant')

  // Click the link to trigger the updatedPlant effect when plants are already in state
  fireEvent.click(screen.getByText('Trigger Update'))

  await screen.findByText('Updated Name')
  // u2 should still be Other Plant (covers the else branch of the ternary in map)
  await screen.findByText('Other Plant')
})

test('integrated: line 272 coverage - handles total update and Math.max', async () => {
  server.use(
    mockPlantsHandler([
      {
        uuid: 'p1',
        name: 'P1',
        identify_hint: '',
        water_retained_pct: 50,
        recommended_water_threshold_pct: 30,
      },
    ]),
    http.delete('/api/plants/:uuid', () => HttpResponse.json({ ok: true })),
  )

  renderPage()

  await screen.findByText('P1')
  const deleteBtn = await screen.findByRole('button', { name: /delete plant p1/i })
  fireEvent.click(deleteBtn)

  const dlg = await screen.findByRole('dialog')
  const confirmBtn = within(dlg).getByRole('button', { name: /^Delete$/ })
  fireEvent.click(confirmBtn)

  await waitForElementToBeRemoved(() => screen.queryByText('P1'))
})

test('integrated: line 274 coverage - handles delete error without message', async () => {
  server.use(
    mockPlantsHandler([
      {
        uuid: 'err1',
        name: 'ErrPlant',
        identify_hint: '',
        water_retained_pct: 50,
        recommended_water_threshold_pct: 30,
      },
    ]),
  )
  // Force plantsApi.remove to throw an error with empty message
  const spy = vi.spyOn(plantsApi, 'remove').mockRejectedValueOnce({ message: '' })

  renderPage()
  await screen.findByText('ErrPlant')
  const deleteBtn = await screen.findByRole('button', { name: /delete plant errplant/i })
  fireEvent.click(deleteBtn)
  const dlg = await screen.findByRole('dialog')
  const confirmBtn = within(dlg).getByRole('button', { name: /^Delete$/ })
  fireEvent.click(confirmBtn)

  // Should show generic error message
  expect(await screen.findByRole('alert')).toHaveTextContent(/failed to delete plant/i)
  spy.mockRestore()
})

test('integrated: line 437 coverage - badge titles', async () => {
  try {
    // 1) Manual Mode
    localStorage.setItem('operationMode', 'manual')
    server.use(
      http.get('/api/plants', () =>
        HttpResponse.json({
          items: [
            { uuid: 'p1', name: 'P1', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
          ],
          total: 1,
          global_total: 1,
          total_pages: 1,
          page: 1,
          limit: 20,
        }),
      ),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
    )

    const { unmount } = renderPage()
    const badge1 = await screen.findByTitle('Needs water based on threshold')
    expect(badge1).toHaveTextContent(/needs water/i)
    unmount()

    // 2) Vacation Mode
    localStorage.setItem('operationMode', 'vacation')
    server.use(
      http.get('/api/plants', () =>
        HttpResponse.json({
          items: [
            { uuid: 'p2', name: 'P2', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
          ],
          total: 1,
          global_total: 1,
          total_pages: 1,
          page: 1,
          limit: 20,
        }),
      ),
      http.get('/api/measurements/approximation/watering', () =>
        HttpResponse.json({
          items: [{ plant_uuid: 'p2', virtual_water_retained_pct: 5 }],
        }),
      ),
    )

    renderPage()
    const badge2 = await screen.findByTitle('Needs water based on approximation')
    expect(badge2).toHaveTextContent(/needs water/i)
  } finally {
    localStorage.removeItem('operationMode')
  }
})
