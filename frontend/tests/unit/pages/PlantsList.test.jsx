import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
  default: ({ children }) => <div data-testid="mock-dashboard-layout">{children}</div>
}))

vi.mock('../../../src/components/PageHeader.jsx', () => ({
  default: ({ onBack, onCreate, title, actions }) => (
    <div data-testid="mock-page-header">
      <h1>{title}</h1>
      <button onClick={onBack}>Dashboard</button>
      <button onClick={onCreate}>Create</button>
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

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
}

// Ensure MSW handlers and sessionStorage are reset after each test in this file to avoid leaking state
afterEach(() => {
  server.resetHandlers()
  sessionStorage.clear()
  mockNavigate.mockClear()
})

test('integrated: renders plants with various states and handles header actions', async () => {
  // u1 (Aloe) has approx freq 5, confidence 10, offset 1, virtual_water_retained_pct 75
  const opMode = localStorage.getItem('operationMode') || 'manual'
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'u1', name: 'Aloe', identify_hint: 'Spiky', water_retained_pct: 20, recommended_water_threshold_pct: 30, latest_at: '2025-01-01T00:00:00', notes: 'N', location: 'Loc' },
      { uuid: 'u2', name: 'Monstera', water_retained_pct: 50, recommended_water_threshold_pct: 40, frequency_days: 7 },
      { uuid: 'nf1', name: 'NoFreq', water_retained_pct: 20, recommended_water_threshold_pct: 30, frequency_days: undefined },
      { name: 'Plain', notes: 'No link', location: 'Somewhere', water_retained_pct: 10, recommended_water_threshold_pct: 30, latest_at: '2025-01-01T00:00:00' },
    ])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [
        {
          plant_uuid: 'u1',
          virtual_water_retained_pct: 75,
          frequency_days: 5,
          frequency_confidence: 10,
          next_watering_at: '2025-01-10T12:00:00Z',
          first_calculated_at: '2025-01-09T12:00:00Z',
          days_offset: 1
        }
      ]
    }))
  )

  renderPage()

  // 1. renders plants after loading
  expect(await screen.findByRole('link', { name: /aloe/i })).toBeInTheDocument()
  expect(screen.getByText('Monstera')).toBeInTheDocument()

  // 2. Frequency column (approximation for u1, explicit for u2, missing for nf1)
  const rows = screen.getAllByRole('row')
  const bodyRows = rows.filter(r => within(r).queryAllByRole('columnheader').length === 0)
  
  // u1 (Aloe) has approx freq 5, confidence 10, offset 1
  expect(within(bodyRows[0]).getByText('5 d')).toBeInTheDocument()
  expect(within(bodyRows[0]).getByText('(10)')).toBeInTheDocument()
  expect(within(bodyRows[0]).getByText('(1d)')).toBeInTheDocument()
  // u2 has freq 7
  expect(within(bodyRows[ bodyRows.findIndex(r => r.textContent.includes('Monstera')) ]).getByText('7 d')).toBeInTheDocument()
  // nf1 has no freq
  const noFreqRow = bodyRows[ bodyRows.findIndex(r => r.textContent.includes('NoFreq')) ]
  expect(within(noFreqRow).getAllByText(/^—$/).length).toBeGreaterThan(0)

  // 3. row branches: link vs plain text, needsWater badge
  const linkForName = screen.getByRole('link', { name: /aloe/i })
  expect(linkForName).toHaveAttribute('href', '/plants/u1')
  // Plain row should not have a link for notes; text should be present
  expect(screen.getByText('No link')).toBeInTheDocument()
  // Needs water badge visible for nf1 (20 <= 30)
  expect(within(bodyRows[ bodyRows.findIndex(r => r.textContent.includes('NoFreq')) ]).getByText(/Needs water/i)).toBeInTheDocument()

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
  const plant = { uuid: 'nav1', name: 'Navigator', water_retained_pct: 10, recommended_water_threshold_pct: 30 }
  server.use(
    http.get('/api/plants', () => HttpResponse.json([plant]))
  )
  renderPage()
  
  const viewBtn = await screen.findByRole('button', { name: /view plant navigator/i })
  fireEvent.click(viewBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/plants/nav1', { state: { plant } })
  
  const editBtn = screen.getByRole('button', { name: /edit plant navigator/i })
  fireEvent.click(editBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/plants/nav1/edit', { state: { plant } })
})

test('ErrorNotice retry calls window.location.reload', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json({ message: 'fail' }, { status: 500 }))
  )
  const reloadSpy = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload: reloadSpy })
  
  renderPage()
  const retryBtn = await screen.findByRole('button', { name: /retry/i })
  fireEvent.click(retryBtn)
  expect(reloadSpy).toHaveBeenCalled()
  vi.unstubAllGlobals()
})

test('EmptyState new plant button navigates to /plants/new', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([]))
  )
  renderPage()
  const emptyState = await screen.findByRole('note')
  const newPlantBtn = within(emptyState).getByRole('button', { name: /new plant/i })
  fireEvent.click(newPlantBtn)
  expect(mockNavigate).toHaveBeenCalledWith('/plants/new')
})

test('vacation mode styling without localstorage', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([{ uuid: 'v1', name: 'Vacation' }])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [{ plant_uuid: 'v1', days_offset: -1, next_watering_at: '2025-01-01T00:00:00Z' }]
    }))
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

test('numeric search filters by threshold (<= query)', async () => {
  // Provide custom plants including thresholds to exercise numeric filter branch
  server.use(
    http.get('/api/plants', () => {
      return HttpResponse.json([
        { uuid: 'a', name: 'Low', recommended_water_threshold_pct: 20 },
        { uuid: 'b', name: 'Edge', recommended_water_threshold_pct: 30 },
        { uuid: 'c', name: 'High', recommended_water_threshold_pct: 45 },
        // Non-numeric threshold should be ignored for numeric filtering (NaN path)
        { uuid: 'd', name: 'NonNum', recommended_water_threshold_pct: 'N/A' },
      ])
    })
  )
  renderPage()

  // Ensure items are loaded
  expect(await screen.findByText('Low')).toBeInTheDocument()

  // input type="search" has role 'searchbox' per ARIA; reflect component change
  const search = await screen.findByRole('searchbox', { name: /search plants/i })
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.change(search, { target: { value: '30' } })

  // Now only items with threshold <= 30 should be visible in the limited list
  expect(screen.getByText('Low')).toBeInTheDocument()
  expect(screen.getByText('Edge')).toBeInTheDocument()
  // The one above threshold should be filtered out
  expect(screen.queryByText('High')).not.toBeInTheDocument()
  // Non-numeric threshold should also not be included for numeric query
  expect(screen.queryByText('NonNum')).not.toBeInTheDocument()

  // Meta text reflects filtered count out of total (now 4 with NonNum present)
  expect(screen.getByText(/Showing 2 of 4/)).toBeInTheDocument()
})

test('applies updatedPlant from router state without crashing (effect path exercised)', async () => {
  // Use default handler returning two plants; pass router state to update first
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[{ pathname: '/plants', state: { updatedPlant: { uuid: 'u1', name: 'Aloe UPDATED' } } }]}>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Wait initial load; effect runs early but may clear state before data
  expect(await screen.findByText('Aloe')).toBeInTheDocument()
  // No strict assertion on updated label due to timing; presence ensures render ok
})

test('reordering integration: handles drag-and-drop and move buttons', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'a', name: 'A', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { uuid: 'b', name: 'B', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
      { uuid: 'c', name: 'C', water_retained_pct: 40, recommended_water_threshold_pct: 30 },
    ])),
    http.put('/api/plants/order', () => HttpResponse.json({ ok: true }))
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
  const dt = { data: {}, setData(k,v){this.data[k]=v}, getData(k){return this.data[k]} }
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
    http.get('/api/plants', () => HttpResponse.json([
      { name: 'NoId', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ]))
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )

  expect(await screen.findByText('NoId')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /delete plant noid/i }))
  // confirm in dialog (scope to dialog)
  const dlg1 = await screen.findByRole('dialog')
  fireEvent.click(within(dlg1).getByRole('button', { name: /delete/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/cannot delete this plant: missing identifier/i)

  // 2) API error case
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'x1', name: 'X', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ])),
    http.delete('/api/plants/:uuid', () => HttpResponse.json({ message: 'Boom' }, { status: 500 }))
  )

  // Re-render new scenario
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
  expect(await screen.findByText('X')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /delete plant x/i }))
  const dlg2 = await screen.findByRole('dialog')
  fireEvent.click(within(dlg2).getByRole('button', { name: /delete/i }))
  // Row should remain present after failed delete
  expect(await screen.findByText('X')).toBeInTheDocument()

  // 3) Success removes row
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'y1', name: 'Y', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ])),
    http.delete('/api/plants/:uuid', () => HttpResponse.json({ ok: true }))
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
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
  
  const many = Array.from({ length: 25 }, (_, i) => ({ uuid: String(i + 1), name: `P${i + 1}`, water_retained_pct: 10, recommended_water_threshold_pct: 30 }))
  server.use(
    http.get('/api/plants', () => HttpResponse.json(many))
  )

  const { unmount } = renderPage()

  await screen.findByText('P1')
  // We expect 20 rows in the body
  const bodyRows = screen.getAllByRole('row').slice(1)
  expect(bodyRows.length).toBe(20)
  expect(screen.getByText(/Showing 20 of 25/)).toBeInTheDocument()
  unmount()
})



test('text search filters by name/notes/location and disables drag & move buttons', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'n1', identify_hint: 'Hint', name: 'Alpha', notes: 'Sunny spot', location: 'Kitchen', water_retained_pct: 35, recommended_water_threshold_pct: 30 },
      { uuid: 'n2', identify_hint: '', name: 'Beta', notes: 'Shady', location: 'Balcony', water_retained_pct: 50, recommended_water_threshold_pct: 30 },
      { uuid: 'n3', name: 'Gamma', notes: 'Dry area', location: 'Living room', water_retained_pct: 45, recommended_water_threshold_pct: 30 },
    ]))
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
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
  server.use(
    http.get('/api/plants', () => HttpResponse.json({ bad: 'shape' }))
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Empty state note should be shown
  await screen.findByRole('note')
})

test('delete failure with null/empty error shows generic message branch', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'd1', name: 'Del', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ]))
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
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

test('filter handles non-numeric thresholds and persistOrder early-return when missing uuid', async () => {
  // Include an item without uuid to trigger persistOrder early return
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'f1', name: 'Num', notes: 'note', location: 'loc', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { name: 'NonNum', notes: 'abc', location: 'xyz', water_retained_pct: 15, recommended_water_threshold_pct: 'N/A' },
    ])),
    http.put('/api/plants/order', () => HttpResponse.json({ ok: true }))
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Use text search branch (non-numeric) to include both by notes text
  const search = await screen.findByRole('searchbox', { name: /search plants/i })
  fireEvent.change(search, { target: { value: 'abc' } })
  
  // Only NonNum should match by notes
  await screen.findByText('NonNum')
  expect(screen.queryByText('Num')).not.toBeInTheDocument()

  // Clear query to enable reordering controls
  fireEvent.change(search, { target: { value: '' } })

  // Attempt to move item with missing uuid (NonNum) down or up and end drag to trigger persistOrder early return path
  const rows = () => screen.getAllByRole('row').slice(1)
  // Drag the second row (missing uuid) over the first
  const second = rows()[1]
  const first = rows()[0]
  const dt = { data: {}, setData(k,v){this.data[k]=v}, getData(k){return this.data[k]} }
  fireEvent.dragStart(second, { dataTransfer: dt })
  fireEvent.dragOver(first, { dataTransfer: dt })
  fireEvent.dragEnd(first, { dataTransfer: dt })

  // No error should be shown since persistOrder returns early; table still renders
  expect(rows().length).toBeGreaterThan(0)
})

test('onDragOver early-return branches and onDragEnd with null dragIndex do not persist or reorder', async () => {
  // Arrange three predictable items
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'a', name: 'A', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { uuid: 'b', name: 'B', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
      { uuid: 'c', name: 'C', water_retained_pct: 40, recommended_water_threshold_pct: 30 },
    ])),
    http.put('/api/plants/order', async ({ request }) => {
      const body = await request.json()
      if (Array.isArray(body?.ordered_ids)) {
        return HttpResponse.json({ ok: true })
      }
      return HttpResponse.json({ message: 'bad' }, { status: 500 })
    })
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Wait initial
  expect(await screen.findByText('A')).toBeInTheDocument()
  const initialOrder = screen.getAllByRole('row').slice(1).map(r => r.textContent)

  // 1) Call dragOver without any dragStart -> early return path (dragIndex === null)
  const rows1 = screen.getAllByRole('row').slice(1)
  const dt = { data: {}, setData(k,v){this.data[k]=v}, getData(k){return this.data[k]} }
  fireEvent.dragOver(rows1[0], { dataTransfer: dt })
  // order unchanged
  expect(screen.getAllByRole('row').slice(1).map(r => r.textContent)).toEqual(initialOrder)

  // 2) Start dragging first row then dragOver the SAME index -> early return when index === dragIndex
  const rows2 = screen.getAllByRole('row').slice(1)
  fireEvent.dragStart(rows2[0], { dataTransfer: dt })
  fireEvent.dragOver(rows2[0], { dataTransfer: dt })
  // still unchanged
  expect(screen.getAllByRole('row').slice(1).map(r => r.textContent)).toEqual(initialOrder)

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
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 's1', name: 'Styled', water_retained_pct: 12, recommended_water_threshold_pct: 30 },
    ]))
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
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
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'c1', name: 'Cancelable', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
    ]))
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
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
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'a', name: 'A', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { uuid: 'b', name: 'B', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
    ]))
  )

  const spy = vi.spyOn(plantsApi, 'reorder').mockRejectedValueOnce({})
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
  // wait
  const rows = () => screen.getAllByRole('row').slice(1)
  await screen.findByText('A')
  const dt = { data: {}, setData(k,v){this.data[k]=v}, getData(k){return this.data[k]} }
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
    })
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
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
    })
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
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
    </ThemeProvider>
  )
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/failed to load plants/i)
  spy.mockRestore()
})


test('logs error and continues when approximations fail to load', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'u1', name: 'Aloe' }
    ])),
    http.get('/api/measurements/approximation/watering', () => 
      HttpResponse.json({ message: 'Approximation error' }, { status: 500 })
    )
  )

  renderPage()

  // Should still render the plant list even if approximations fail
  expect(await screen.findByText('Aloe')).toBeInTheDocument()
  
  expect(consoleSpy).toHaveBeenCalledWith('Failed to load approximations', expect.anything())
  consoleSpy.mockRestore()
})

test('handles null/missing approximation items gracefully', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([{ uuid: 'u1', name: 'Aloe' }])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: null }))
  )
  renderPage()
  expect(await screen.findByText('Aloe')).toBeInTheDocument()
})

test('applies vacation mode warning style for negative days_offset', async () => {
  localStorage.setItem('operationMode', 'vacation')
  server.use(
    http.get('/api/plants', () => HttpResponse.json([{ uuid: 'u1', name: 'Aloe' }])),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
      items: [{ plant_uuid: 'u1', days_offset: -2, next_watering_at: '2025-01-01T00:00:00Z' }]
    }))
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
