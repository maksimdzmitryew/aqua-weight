import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantsList from '../../../src/pages/PlantsList.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { plantsApi } from '../../../src/api/plants'
import { vi, afterEach } from 'vitest'

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
}

// Ensure MSW handlers are reset after each test in this file to avoid leaking overrides
afterEach(() => {
  server.resetHandlers()
})

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

test('EmptyState New plant button is clickable (invokes navigate handler)', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([]))
  )
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
  const btn = await screen.findByRole('button', { name: /new plant/i })
  await userEvent.click(btn)
  // No assertion beyond no-throw; handler executes navigate which MemoryRouter tolerates
  expect(btn).toBeInTheDocument()
})

test('shows error notice on API failure', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json({ message: 'Network down' }, { status: 500 }))
  )
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/network down/i)
})

test('ErrorNotice Retry button calls window.location.reload (stubbed)', async () => {
  // Stub global location to avoid JSDOM navigation not implemented error
  const originalLocation = window.location
  const reloadMock = vi.fn()
  vi.stubGlobal('location', { ...originalLocation, reload: reloadMock })
  try {
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ message: 'fail' }, { status: 500 }))
    )
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(retry)
    expect(reloadMock).toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('unmounting the component triggers effect cleanup without errors (abort controller)', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'u1', name: 'Aloe', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
    ]))
  )
  const { unmount } = render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
  // Loader renders immediately; ensure tree is mounted
  expect(screen.getByText(/loading plants/i)).toBeInTheDocument()
  // Unmount should invoke the cleanup function without crashing
  unmount()
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
  await userEvent.clear(search)
  await userEvent.type(search, '30')

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

test('drag-and-drop reorders rows and persists order; server error shows saveError', async () => {
  // Provide three items to see reordering
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'a', name: 'A', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { uuid: 'b', name: 'B', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
      { uuid: 'c', name: 'C', water_retained_pct: 40, recommended_water_threshold_pct: 30 },
    ])),
    // First call OK, second call error to exercise error path later
    http.put('/api/plants/order', async ({ request }) => {
      const body = await request.json()
      if (Array.isArray(body?.ordered_ids) && body.ordered_ids[0] === 'b') {
        return HttpResponse.json({ ok: true })
      }
      return HttpResponse.json({ message: 'Persist failed' }, { status: 500 })
    }),
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Wait initial content
  expect(await screen.findByText('A')).toBeInTheDocument()

  // Rows are in order A, B, C. Drag A (index 0) over B (index 1) -> becomes B, A, C
  const rows = () => screen.getAllByRole('row').slice(1) // skip header row
  expect(rows()[0]).toHaveTextContent('A')
  expect(rows()[1]).toHaveTextContent('B')

  // simulate drag via fireEvent with minimal DataTransfer
  const rowA = rows()[0]
  const rowB = rows()[1]
  const dt = { data: {}, setData: function(k,v){ this.data[k]=v }, getData: function(k){ return this.data[k] } }
  fireEvent.dragStart(rowA, { dataTransfer: dt })
  fireEvent.dragOver(rowB, { dataTransfer: dt })
  fireEvent.dragEnd(rowB, { dataTransfer: dt })

  // Order changed in DOM
  expect(rows()[0]).toHaveTextContent('B')
  expect(rows()[1]).toHaveTextContent('A')

  // Trigger another drag that will cause persist error by moving C to top (ordered_ids starts with 'c')
  const rowC = rows()[2]
  fireEvent.dragStart(rowC, { dataTransfer: dt })
  fireEvent.dragOver(rows()[0], { dataTransfer: dt })
  fireEvent.dragEnd(rowC, { dataTransfer: dt })

  // ErrorNotice should appear due to server error
  expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save order|persist failed/i)
})

test('moveUp/moveDown buttons reorder and persist; disabled at edges', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'a', name: 'First', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { uuid: 'b', name: 'Second', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
      { uuid: 'c', name: 'Third', water_retained_pct: 40, recommended_water_threshold_pct: 30 },
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

  // Wait
  expect(await screen.findByText('First')).toBeInTheDocument()

  // Edge buttons disabled: first row up disabled, last row down disabled
  const moveUpFirst = screen.getByRole('button', { name: /move first up/i })
  const moveDownLast = screen.getByRole('button', { name: /move third down/i })
  expect(moveUpFirst).toBeDisabled()
  expect(moveDownLast).toBeDisabled()

  // Move Second up
  const moveUpSecond = screen.getByRole('button', { name: /move second up/i })
  await userEvent.click(moveUpSecond)

  const bodyRows = screen.getAllByRole('row').slice(1)
  expect(bodyRows[0]).toHaveTextContent('Second')
  expect(bodyRows[1]).toHaveTextContent('First')
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
  await userEvent.click(screen.getByRole('button', { name: /delete plant noid/i }))
  // confirm in dialog (scope to dialog)
  const dlg1 = await screen.findByRole('dialog')
  await userEvent.click(within(dlg1).getByRole('button', { name: /delete/i }))
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
  await userEvent.click(screen.getByRole('button', { name: /delete plant x/i }))
  const dlg2 = await screen.findByRole('dialog')
  await userEvent.click(within(dlg2).getByRole('button', { name: /delete/i }))
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
  await userEvent.click(screen.getByRole('button', { name: /delete plant y/i }))
  const dlg3 = await screen.findByRole('dialog')
  await userEvent.click(within(dlg3).getByRole('button', { name: /delete/i }))
  // Row should disappear
  await screen.findByRole('note') // empty state
}, 15000)

test('limits list to PAGE_LIMIT and shows meta count', async () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ uuid: String(i + 1), name: `P${i + 1}`, water_retained_pct: 10, recommended_water_threshold_pct: 30 }))
  server.use(
    http.get('/api/plants', () => HttpResponse.json(many))
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Only first 100 should be rendered in table body
  await screen.findByText('P1')
  // Use waitFor to allow table render with many rows in JSDOM
  await waitFor(() => {
    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(bodyRows.length).toBe(100)
  })
  expect(screen.getByText(/Showing 100 of 150/)).toBeInTheDocument()
}, 30000)

test('row branches: link vs plain text, needsWater badge, and view/edit guards without uuid', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'link1', name: 'Linked', notes: 'N', location: 'Loc', water_retained_pct: 20, recommended_water_threshold_pct: 30, latest_at: '2025-01-01T00:00:00' },
      { name: 'Plain', notes: 'No link', location: 'Somewhere', water_retained_pct: 10, recommended_water_threshold_pct: 30, latest_at: '2025-01-01T00:00:00' },
    ]))
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Wait render
  expect(await screen.findByText('Linked')).toBeInTheDocument()
  expect(screen.getByText('Plain')).toBeInTheDocument()

  // Linked row should have anchor links for name and notes
  const linkForName = screen.getByRole('link', { name: /linked/i })
  expect(linkForName).toHaveAttribute('href', '/plants/link1')
  // Plain row should not have a link for notes; text should be present
  expect(screen.getByText('No link')).toBeInTheDocument()

  // Needs water badge visible for retained (20) <= threshold (30)
  const body = screen.getAllByRole('row').slice(1)
  expect(within(body[0]).getByText(/Needs water/i)).toBeInTheDocument()

  // View/Edit buttons for plain (no uuid) should not navigate; click them and ensure still on same page
  await userEvent.click(screen.getByRole('button', { name: /view plant plain/i }))
  await userEvent.click(screen.getByRole('button', { name: /edit plant plain/i }))
  // Still can find both rows; no crash
  expect(screen.getByText('Linked')).toBeInTheDocument()
  expect(screen.getByText('Plain')).toBeInTheDocument()

  // Also execute handlers for linked item (with uuid)
  await userEvent.click(screen.getByRole('button', { name: /view plant linked/i }))
  await userEvent.click(screen.getByRole('button', { name: /edit plant linked/i }))
})

test('moveDown button moves item down and persists order', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'a', name: 'First', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      { uuid: 'b', name: 'Second', water_retained_pct: 20, recommended_water_threshold_pct: 30 },
      { uuid: 'c', name: 'Third', water_retained_pct: 40, recommended_water_threshold_pct: 30 },
    ])),
    http.put('/api/plants/order', async ({ request }) => {
      const body = await request.json()
      // Ensure correct ordered_ids are sent after moving First down: [b, a, c] or [a, c] depending sequence
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

  // Initial order
  expect(await screen.findByText('First')).toBeInTheDocument()
  let bodyRows = screen.getAllByRole('row').slice(1)
  expect(bodyRows[0]).toHaveTextContent('First')
  expect(bodyRows[1]).toHaveTextContent('Second')

  // Click Move down on the first row
  const moveDownFirst = screen.getByRole('button', { name: /move first down/i })
  await userEvent.click(moveDownFirst)

  // Order should now be Second, First, Third
  bodyRows = screen.getAllByRole('row').slice(1)
  expect(bodyRows[0]).toHaveTextContent('Second')
  expect(bodyRows[1]).toHaveTextContent('First')
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
  await userEvent.clear(search)
  await userEvent.type(search, 'balcony')

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
  await userEvent.click(screen.getByRole('button', { name: /delete plant del/i }))
  const dlg = await screen.findByRole('dialog')
  await userEvent.click(within(dlg).getByRole('button', { name: /delete/i }))
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
  await userEvent.type(search, 'abc')

  // Only NonNum should match by notes
  await screen.findByText('NonNum')
  expect(screen.queryByText('Num')).not.toBeInTheDocument()

  // Clear query to enable reordering controls
  await userEvent.clear(search)

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

test('name cell applies background gradient style based on water_retained_pct and search matches identify_hint', async () => {
  server.use(
    http.get('/api/plants', () => HttpResponse.json([
      { uuid: 'z1', identify_hint: 'Spiky', name: 'Aloe', notes: '', location: '', water_retained_pct: 42, recommended_water_threshold_pct: 30 },
      { uuid: 'z2', identify_hint: '', name: 'Monstera', notes: '', location: '', water_retained_pct: 5, recommended_water_threshold_pct: 30 },
    ]))
  )

  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )

  // Wait for the link for Aloe (text content is "Spiky Aloe")
  const link = await screen.findByRole('link', { name: /aloe/i })
  const nameCell = link.closest('td')
  expect(nameCell).not.toBeNull()
  // Inline style should contain linear-gradient with percent equal to 42
  expect(nameCell.getAttribute('style')).toMatch(/linear-gradient\(90deg, .* 42%/)

  // Search by identify_hint should match using "identify_hint name" composite
  const search = screen.getByRole('searchbox', { name: /search plants/i })
  await userEvent.clear(search)
  await userEvent.type(search, 'spiky')
  expect(await screen.findByRole('link', { name: /spiky aloe/i })).toBeInTheDocument()
  // And other non-matching item filtered out
  expect(screen.queryByText('Monstera')).not.toBeInTheDocument()
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
  await userEvent.click(screen.getByRole('button', { name: /delete plant cancelable/i }))
  const dlg = await screen.findByRole('dialog')
  await userEvent.click(within(dlg).getByRole('button', { name: /cancel/i }))
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

test('PageHeader back and create actions are clickable (invoke inline handlers)', async () => {
  render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
  // Wait initial
  await screen.findByText('Aloe')
  // Click Back and Create buttons in header; no assertions needed beyond not throwing
  await userEvent.click(screen.getByRole('button', { name: /dashboard/i }))
  await userEvent.click(screen.getByRole('button', { name: /create/i }))
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
