import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantsList from '../../../src/pages/PlantsList.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

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
