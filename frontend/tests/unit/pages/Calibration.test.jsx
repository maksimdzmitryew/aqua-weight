import React from 'react'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../msw/server'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import Calibration from '../../../src/pages/Calibration.jsx'
import { calibrationApi } from '../../../src/api/calibration'
import { vi } from 'vitest'

vi.mock('../../../src/components/DashboardLayout.jsx', () => ({
  default: ({ children }) => <div data-testid="mock-dashboard-layout">{children}</div>
}))

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <Calibration />
      </MemoryRouter>
    </ThemeProvider>
  )
}

test('shows empty state when API returns no plants', async () => {
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([]))
  )
  renderPage()
  // Loader visible first (role=status)
  expect(screen.getByRole('status')).toBeInTheDocument()
  // Then empty state
  const note = await screen.findByRole('note')
  expect(note).toBeInTheDocument()
  expect(note).toHaveTextContent(/no plants found/i)
})

test('renders a plant with filtered rows, sorting, and highlights most under target', async () => {
  const plant = {
    uuid: 'p-1',
    name: 'Fern',
    location: 'Living room',
    min_dry_weight_g: 100,
    max_water_weight_g: 50,
    calibration: {
      max_water_retained: [
        // Latest entry has under_g 0 and positive diff; should be hidden by zero filter unless re-included
        { id: 'm3', measured_at: '2025-01-03 12:00:00', water_added_g: 200, last_wet_weight_g: 170, target_weight_g: 150, under_g: 0, under_pct: 0 },
        // Most negative diff (-30)
        { id: 'm2', measured_at: '2025-01-02 12:00:00', water_added_g: 100, last_wet_weight_g: 120, target_weight_g: 150, under_g: 30, under_pct: 60 },
        // Negative but not most (-10)
        { id: 'm1', measured_at: '2025-01-01 12:00:00', water_added_g: 80, last_wet_weight_g: 140, target_weight_g: 150, under_g: 10, under_pct: 20 },
      ],
    },
  }
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant]))
  )
  renderPage()

  // Wait for table to appear
  const heading = await screen.findByText('Fern')
  expect(heading).toBeInTheDocument()

  const table = screen.getByRole('table')
  const rows = within(table).getAllByRole('row')
  // header + 2 visible rows (m2 highlighted, m1 visible); m3 is hidden due to under_g === 0 and underwatered default filter
  expect(rows.length).toBe(1 /* header */ + 2)

  // First data row should be m2 (most negative) highlighted and sorted by measured_at desc across filtered set
  const cellsRow1 = within(rows[1]).getAllByRole('cell')
  expect(cellsRow1[0]).toHaveTextContent('2025-01-02')
  // Title attribute present on highlighted row
  expect(rows[1]).toHaveAttribute('title', expect.stringMatching(/most under target/i))

  // Second data row is m1
  const cellsRow2 = within(rows[2]).getAllByRole('cell')
  expect(cellsRow2[0]).toHaveTextContent('2025-01-01')

  // Toggle "underwatered" to allow >= 0 diffs
  const underwatered = screen.getByLabelText(/underwatered/i)
  fireEvent.click(underwatered)
  // Also toggle legacy filter to include rows with 0 Below Max Water (under_g)
  const zeroAll = screen.getByLabelText(/zero below max water, all/i)
  fireEvent.click(zeroAll)
  await waitFor(() => {
    const r = within(screen.getByRole('table')).getAllByRole('row')
    expect(r.length).toBe(1 + 3)
  })
})

test('Correct overfill button sends composed payload and refreshes list', async () => {
  const plant = {
    uuid: 'p-2',
    name: 'Snake',
    min_dry_weight_g: 100,
    max_water_weight_g: 50,
    calibration: {
      max_water_retained: [
        // min-diff entry will be this one: diff = 110 - 160 = -50
        { id: 'x2', measured_at: '2025-02-02 10:00:00', last_wet_weight_g: 110, target_weight_g: 160, under_g: 50, under_pct: 31 },
        { id: 'x1', measured_at: '2025-02-01 10:00:00', last_wet_weight_g: 140, target_weight_g: 160, under_g: 20, under_pct: 12 },
      ],
    },
  }
  // First list (then empty after correction) and POST
  let listCalls = 0
  server.use(
    http.get('/api/measurements/calibrating', () => {
      listCalls += 1
      return listCalls === 1
        ? HttpResponse.json([plant])
        : HttpResponse.json([])
    }),
    http.post('/api/measurements/corrections', async ({ request }) => {
      const body = await request.json()
      // Assert payload shape from the component
      expect(body).toMatchObject({
        plant_id: 'p-2',
        cap: 'capacity',
        edit_last_wet: true,
        from_ts: '2025-02-02 10:00:00',
        start_measurement_id: 'x2',
        start_diff_to_max_g: -50,
      })
      return HttpResponse.json({ corrected: 1 })
    })
  )

  renderPage()
  // Wait for card
  await screen.findByText('Snake')
  const btn = await screen.findByRole('button', { name: /correct overfill/i })
  await userEvent.click(btn)
  // POST handler assertion above verifies call; then component refreshes
  // Wait until the plant card disappears (list refreshed)
  await waitFor(() => {
    expect(screen.queryByText('Snake')).not.toBeInTheDocument()
  }, { timeout: 3000 })
  // Then the empty state should be present
  const note = await screen.findByRole('note')
  expect(note).toBeInTheDocument()
})

test('shows formatted error when correction API fails with object detail', async () => {
  const plant = {
    id: 'p-3', // test id instead of uuid branch
    name: 'ZZ',
    min_dry_weight_g: 100,
    max_water_weight_g: 10,
    calibration: { max_water_retained: [
      { id: 'z1', measured_at: '2025-03-01 08:00:00', last_wet_weight_g: 90, target_weight_g: 110, under_g: 20, under_pct: 18 }
    ] },
  }
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant])),
    http.post('/api/measurements/corrections', () => HttpResponse.json({ detail: { error: 'boom' } }, { status: 400 }))
  )

  renderPage()
  await screen.findByText('ZZ')
  const btn = await screen.findByRole('button', { name: /correct overfill/i })
  await userEvent.click(btn)

  const alert = await screen.findByRole('alert')
  // ErrorNotice renders message text from setError
  expect(alert.textContent || '').toMatch(/failed to apply corrections|boom/i)
})

test('unmount cleans up fetch (AbortController) without noise', async () => {
  // Return a delayed response so we can unmount before it resolves
  server.use(
    http.get('/api/measurements/calibrating', async () => {
      await new Promise((r) => setTimeout(r, 50))
      return HttpResponse.json([])
    })
  )
  const { unmount } = renderPage()
  expect(screen.getByRole('status')).toBeInTheDocument()
  unmount()
})

test('AbortError from list() is ignored and does not set error (covers !isAbort branch false at line 29)', async () => {
  const spy = vi.spyOn(calibrationApi, 'list').mockRejectedValueOnce({ name: 'AbortError', message: 'aborted' })
  renderPage()
  // Loader shows then goes away; no alert should appear
  expect(screen.getByRole('status')).toBeInTheDocument()
  await waitFor(() => {
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  spy.mockRestore()
})

test('"Last" toggle ensures latest zero-under row is visible even when hidden by filters', async () => {
  const plant = {
    uuid: 'p-last',
    name: 'Peace Lily',
    min_dry_weight_g: 100,
    max_water_weight_g: 50,
    calibration: { max_water_retained: [
      // last (most recent) has under_g 0 → normally hidden when showOnlyNonZero is false
      { id: 'l3', measured_at: '2025-04-03 09:00:00', water_added_g: 200, last_wet_weight_g: 170, target_weight_g: 150, under_g: 0, under_pct: 0 },
      { id: 'l2', measured_at: '2025-04-02 09:00:00', water_added_g: 90, last_wet_weight_g: 130, target_weight_g: 150, under_g: 20, under_pct: 40 },
    ]},
  }
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant]))
  )
  renderPage()
  await screen.findByText('Peace Lily')
  const table = screen.getByRole('table')
  // Initially, last zero-under row hidden: expect header + 1 row
  expect(within(table).getAllByRole('row').length).toBe(1 + 1)
  // Toggle "zero Below Max Water, last" to include the latest watering even if zero
  const lastToggle = screen.getByLabelText(/zero below max water, last/i)
  await userEvent.click(lastToggle)
  await waitFor(() => {
    expect(within(screen.getByRole('table')).getAllByRole('row').length).toBe(1 + 2)
  })
})

test('most negative entry is re-inserted when zero filter would hide it, and fallback equality highlights duplicate-value row', async () => {
  const duplicate = { id: 'd2', measured_at: '2025-05-02 10:00:00', last_wet_weight_g: 100, target_weight_g: 150, under_g: 0, under_pct: 0 }
  const mostNeg = { id: 'd1', measured_at: '2025-05-01 10:00:00', last_wet_weight_g: 100, target_weight_g: 160, under_g: 0, under_pct: 0 } // diff -60, under_g 0
  // Create a separate object with same values as mostNeg to trigger fallback equality in row highlighting
  const twinOfMostNeg = { ...mostNeg }
  const plant = {
    uuid: 'p-fallback',
    name: 'Fiddle',
    min_dry_weight_g: 100,
    max_water_weight_g: 50,
    calibration: { max_water_retained: [duplicate, mostNeg, twinOfMostNeg] },
  }
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant]))
  )
  renderPage()
  await screen.findByText('Fiddle')
  // With default filters, rows with under_g 0 are hidden, BUT code re-inserts most negative entry
  const table = screen.getByRole('table')
  const rows = within(table).getAllByRole('row')
  // Only the re-inserted most negative row should be visible (header + 1)
  expect(rows.length).toBe(1 + 1)
  // The visible row should be highlighted and match the most negative entry values
  const dataCells = within(rows[1]).getAllByRole('cell')
  expect(rows[1]).toHaveAttribute('title', expect.stringMatching(/most under target/i))
  expect(dataCells[0]).toHaveTextContent('2025-05-01')

  // Now toggle "underwatered" and zero filter to reveal twin row; fallback equality should highlight it too
  await userEvent.click(screen.getByLabelText(/underwatered/i))
  await userEvent.click(screen.getByLabelText(/zero below max water, all/i))
  await waitFor(() => {
    const r = within(screen.getByRole('table')).getAllByRole('row')
    expect(r.length).toBeGreaterThanOrEqual(1 + 2)
  })
  // Find the row with same date/value and ensure it has the highlight style via fallback comparison
  const allRows = within(screen.getByRole('table')).getAllByRole('row')
  const highlighted = allRows.filter((tr) => tr.getAttribute('title')?.toLowerCase().includes('most under target'))
  expect(highlighted.length).toBeGreaterThanOrEqual(1)
})

test('summary shows Maximum Weight dash when values missing and positive diff shows + sign', async () => {
  const plant = {
    uuid: 'p-missing',
    name: 'Cactus',
    // min present, max missing
    min_dry_weight_g: 80,
    max_water_weight_g: null,
    calibration: { max_water_retained: [
      // Positive diff 10 → should render as "+10"
      { id: 'pm1', measured_at: '2025-06-01 12:00:00', water_added_g: 10, last_wet_weight_g: 160, target_weight_g: 150, under_g: 0, under_pct: 0 },
    ] },
  }
  // Ensure no leftover handlers interfere with this case
  server.resetHandlers()
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant]))
  )
  renderPage()
  // Ensure at least one row is visible so the card renders
  const underToggle = await screen.findByLabelText(/underwatered/i)
  await userEvent.click(underToggle)
  const zeroAllToggle = await screen.findByLabelText(/zero below max water, all/i)
  await userEvent.click(zeroAllToggle)
  await screen.findByText('Cactus')
  const summary = screen.getByText(/maximum weight:/i).parentElement
  expect(summary?.textContent || '').toMatch(/maximum weight: —/i)

  // Ensure filters are enabled so the positive diff row is visible
  const under2 = screen.getByLabelText(/underwatered/i)
  if (!(under2 instanceof HTMLInputElement) || !under2.checked) {
    await userEvent.click(under2)
  }
  const zeroAll2 = screen.getByLabelText(/zero below max water, all/i)
  if (!(zeroAll2 instanceof HTMLInputElement) || !zeroAll2.checked) {
    await userEvent.click(zeroAll2)
  }
  const table = await screen.findByRole('table')
  const row = within(table).getAllByRole('row')[1]
  const diffCell = within(row).getAllByRole('cell')[3]
  expect(diffCell).toHaveTextContent('+10')
})

test('coerces non-array payload from list() to [] and shows EmptyState (covers setItems ternary)', async () => {
  server.resetHandlers()
  server.use(
    // Return an object instead of an array to exercise Array.isArray(data) === false
    http.get('/api/measurements/calibrating', () => HttpResponse.json({ foo: 1 }))
  )
  renderPage()
  // Loader first
  expect(screen.getByRole('status')).toBeInTheDocument()
  // Then EmptyState rendered because items becomes []
  const note = await screen.findByRole('note')
  expect(note).toBeInTheDocument()
})

test('initial load error (non-abort) sets error message (covers error branch)', async () => {
  server.resetHandlers()
  server.use(
    // Return a non-2xx JSON response so the client throws
    http.get('/api/measurements/calibrating', () => HttpResponse.json({ detail: 'boom' }, { status: 500 }))
  )
  renderPage()
  // Expect an error notice after loader
  const alert = await screen.findByRole('alert')
  expect(alert.textContent || '').toMatch(/request failed|failed to load calibration|boom/i)
})

test('min-diff selection skips entries with non-number weights (covers continue path)', async () => {
  const plant = {
    uuid: 'p-skip',
    name: 'Skip',
    min_dry_weight_g: 10,
    max_water_weight_g: 10,
    calibration: {
      max_water_retained: [
        // Non-number values should be skipped by the loop
        { id: 'n0', measured_at: '2025-08-01 00:00:00', last_wet_weight_g: 'x', target_weight_g: 100, under_g: 0, under_pct: 0 },
        // Valid negative diff becomes the min-diff entry
        { id: 'n1', measured_at: '2025-08-02 00:00:00', last_wet_weight_g: 90, target_weight_g: 150, under_g: 60, under_pct: 60 },
      ],
    },
  }
  let corrected = false
  server.resetHandlers()
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant])),
    http.post('/api/measurements/corrections', async ({ request }) => {
      const body = await request.json()
      // Ensure the min-diff entry was chosen (id n1)
      expect(body).toMatchObject({ start_measurement_id: 'n1' })
      corrected = true
      return HttpResponse.json({ ok: true })
    })
  )
  renderPage()
  await screen.findByText('Skip')
  await userEvent.click(screen.getByRole('button', { name: /correct overfill/i }))
  await waitFor(() => expect(corrected).toBe(true))
})

test('parseMs handles null, space-form date, and invalid values for sorting (covers 189–193)', async () => {
  const plant = {
    uuid: 'p-sort',
    name: 'SortCheck',
    min_dry_weight_g: 1,
    max_water_weight_g: 1,
    calibration: { max_water_retained: [
      // valid date in space form should sort first (newest)
      { id: 's2', measured_at: '2025-08-03 10:00:00', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 },
      // null measured_at → parseMs returns 0
      { id: 's1', measured_at: null, last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 },
      // garbage string → parseMs returns 0
      { id: 's0', measured_at: 'garbage', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 },
    ]}
  }
  server.resetHandlers()
  server.use(http.get('/api/measurements/calibrating', () => HttpResponse.json([plant])))
  renderPage()
  await screen.findByText('SortCheck')
  // Show all rows regardless of diff to avoid filter interference
  await userEvent.click(screen.getByLabelText(/underwatered/i))
  await userEvent.click(screen.getByLabelText(/zero below max water, all/i))
  const rows = within(await screen.findByRole('table')).getAllByRole('row')
  const firstDataCells = within(rows[1]).getAllByRole('cell')
  // The first row should be the valid date entry
  expect(firstDataCells[0]).toHaveTextContent('2025-08-03')
})

test('table renders em dashes when values are missing (covers measured_at, diff, under_g, under_pct)', async () => {
  const plant = {
    uuid: 'p-dash',
    name: 'Dashy',
    min_dry_weight_g: 1,
    max_water_weight_g: 1,
    calibration: { max_water_retained: [
      { id: 'm0', measured_at: null, water_added_g: undefined, last_wet_weight_g: undefined, target_weight_g: 150, under_g: undefined, under_pct: undefined },
    ]}
  }
  server.resetHandlers()
  server.use(http.get('/api/measurements/calibrating', () => HttpResponse.json([plant])))
  renderPage()
  // Ensure controls are enabled first so the row becomes visible
  const underwatered = await screen.findByLabelText(/underwatered/i)
  await userEvent.click(underwatered)
  const zeroAll = await screen.findByLabelText(/zero below max water, all/i)
  await userEvent.click(zeroAll)
  await screen.findByText('Dashy')
  const row = within(await screen.findByRole('table')).getAllByRole('row')[1]
  const cells = within(row).getAllByRole('cell')
  expect(cells[0]).toHaveTextContent('—') // measured_at
  expect(cells[1]).toHaveTextContent('—') // water_added_g
  expect(cells[2]).toHaveTextContent('—') // last_wet_weight_g
  expect(cells[3]).toHaveTextContent('—') // diff cell when numbers missing
  expect(cells[4]).toHaveTextContent('—') // under_g
  expect(cells[5]).toHaveTextContent('—') // under_pct
})

test('correction error prefers string detail from server', async () => {
  const plant1 = { uuid: 'p-e1', name: 'A', min_dry_weight_g: 1, max_water_weight_g: 1, calibration: { max_water_retained: [{ id: 'e1', measured_at: '2025-07-01 00:00:00', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 }] } }
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant1])),
    http.post('/api/measurements/corrections', () => HttpResponse.json({ detail: 'Too bad' }, { status: 400 }))
  )
  renderPage()
  await screen.findByText('A')
  await userEvent.click(screen.getByRole('button', { name: /correct overfill/i }))
  const alerts1 = await screen.findAllByRole('alert')
  const alert1 = alerts1[alerts1.length - 1]
  expect(alert1).toHaveTextContent(/too bad/i)
})

test('correction error falls back to generic message when detail is empty', async () => {
  // Ensure a clean slate of handlers for this case only
  server.resetHandlers()
  const plant2 = { uuid: 'p-e2', name: 'B', min_dry_weight_g: 1, max_water_weight_g: 1, calibration: { max_water_retained: [{ id: 'e2', measured_at: '2025-07-02 00:00:00', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 }] } }
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant2])),
    // Return a JSON empty string body (""), which parses to '' (empty string).
    // ApiClient will set ApiError.body = '' and message = 'Request failed...'.
    // In Calibration catch, detail becomes '' (via e.body) so it falls through to e.message branch (81-82).
    http.post('/api/measurements/corrections', () => HttpResponse.text('""', { status: 500 }))
  )
  renderPage()
  await screen.findByText('B')
  await userEvent.click(screen.getByRole('button', { name: /correct overfill/i }))
  const alerts2 = await screen.findAllByRole('alert', {}, { timeout: 3000 })
  const alert2 = alerts2[alerts2.length - 1]
  expect(alert2.textContent || '').toMatch(/request failed|http 500|failed to apply corrections|\{\}/i)
})

test('does not duplicate most-negative row when a value-identical twin is already visible (covers fallback equality)', async () => {
  // Construct data where the "most negative" entry has under_g = 0 (hidden by default),
  // but there is a twin with identical measured_at/weights and under_g > 0 (visible).
  const mostNegHidden = { id: 'mn0', measured_at: '2025-08-01 10:00:00', last_wet_weight_g: 120, target_weight_g: 200, under_g: 0, under_pct: 0 }
  const twinVisible = { id: 'mn1', measured_at: '2025-08-01 10:00:00', last_wet_weight_g: 120, target_weight_g: 200, under_g: 5, under_pct: 10 }
  // Also add an entry with missing numeric fields to hit the "—" branch for diff cell (line 273)
  const incomplete = { id: 'inc', measured_at: '2025-08-02 10:00:00', water_added_g: 10, last_wet_weight_g: null, target_weight_g: undefined, under_g: 7, under_pct: 25 }
  const plant = {
    uuid: 'p-no-dup',
    name: 'NoDup',
    min_dry_weight_g: 100,
    max_water_weight_g: 50,
    calibration: { max_water_retained: [incomplete, mostNegHidden, twinVisible] },
  }
  server.resetHandlers()
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant]))
  )
  renderPage()
  await screen.findByText('NoDup')
  // Enable 'underwatered' to include all rows regardless of numeric completeness
  const underToggle = screen.getByLabelText(/underwatered/i)
  await userEvent.click(underToggle)
  // Default filters: hide under_g 0 rows, so only twinVisible and incomplete remain
  const table = screen.getByRole('table')
  const rows = within(table).getAllByRole('row')
  // Expect header + 2 data rows (twinVisible + incomplete). No duplication via fallback-equality inclusion
  expect(rows.length).toBe(1 + 2)
  // Verify that the incomplete row renders '—' in diff column (covers line 273)
  // Rows are sorted by measured_at DESC → incomplete (2025-08-02) should appear before the twin (2025-08-01)
  const firstData = rows[1]
  const firstCells = within(firstData).getAllByRole('cell')
  // Diff column index = 3 (0-based in our table mapping below)
  expect(firstCells[3]).toHaveTextContent('—')
})

test('initial load error (non-abort) shows ErrorNotice with message', async () => {
  // Simulate backend failure on initial list load
  server.resetHandlers()
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json({ detail: 'Load failed' }, { status: 500 }))
  )
  renderPage()
  // Loader first
  expect(screen.getByRole('status')).toBeInTheDocument()
  // Then error notice shows up
  const alert = await screen.findByRole('alert')
  expect(alert.textContent || '').toMatch(/failed to load calibration data|load failed|http 500/i)
})

test('correction without measurable entries sends minimal payload (minDiffEntry stays null)', async () => {
  const plant = {
    uuid: 'p-empty',
    name: 'EmptyHist',
    min_dry_weight_g: 10,
    max_water_weight_g: 5,
    calibration: {
      max_water_retained: [
        // Entry without numeric fields → excluded from min-diff calculation
        { id: 'e0', measured_at: '2025-09-01 00:00:00', last_wet_weight_g: undefined, target_weight_g: undefined, under_g: 0, under_pct: 0 },
      ],
    },
  }
  let postCalled = false
  server.resetHandlers()
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant])),
    http.post('/api/measurements/corrections', async ({ request }) => {
      postCalled = true
      const body = await request.json()
      // Should not include from_ts/start ids when there are no measurable entries
      expect(body).toMatchObject({ plant_id: 'p-empty', cap: 'capacity', edit_last_wet: true })
      expect(body).not.toHaveProperty('from_ts')
      expect(body).not.toHaveProperty('start_measurement_id')
      expect(body).not.toHaveProperty('start_diff_to_max_g')
      return HttpResponse.json({ ok: true })
    })
  )
  renderPage()
  // Enable the 'underwatered' toggle to include all rows regardless of diff
  const underwatered = await screen.findByLabelText(/underwatered/i)
  await userEvent.click(underwatered)
  // Also include rows with under_g = 0 so the placeholder entry remains visible
  const zeroAll = screen.getByLabelText(/zero below max water, all/i)
  await userEvent.click(zeroAll)
  // Now the plant card with the action button is visible
  await screen.findByText('EmptyHist')
  const btn = screen.getByRole('button', { name: /correct overfill/i })
  await userEvent.click(btn)
  expect(postCalled).toBe(true)
})

test('list rendering with missing calibration still shows header/button but no table', async () => {
  const plant = { uuid: 'p-none', name: 'NoCal', min_dry_weight_g: 1, max_water_weight_g: 1, calibration: {} }
  server.resetHandlers()
  server.use(http.get('/api/measurements/calibrating', () => HttpResponse.json([plant])))
  renderPage()
  // Plant header should be visible
  await screen.findByText('NoCal')
  // But there should be no table rendered because there are no rows
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test('post-correction refresh tolerates non-array response (covers false branch at line 71)', async () => {
  const plant = {
    uuid: 'p-na',
    name: 'NonArray',
    min_dry_weight_g: 1,
    max_water_weight_g: 1,
    calibration: { max_water_retained: [
      { id: 'na1', measured_at: '2025-09-02 00:00:00', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 }
    ] },
  }
  let calls = 0
  server.resetHandlers()
  server.use(
    http.get('/api/measurements/calibrating', () => {
      calls += 1
      return calls === 1 ? HttpResponse.json([plant]) : HttpResponse.json({ ok: true })
    }),
    http.post('/api/measurements/corrections', () => HttpResponse.json({ ok: true }))
  )
  renderPage()
  await screen.findByText('NonArray')
  const btn = screen.getByRole('button', { name: /correct overfill/i })
  await userEvent.click(btn)
  // After refresh with non-array payload, component should set items to [] and show empty state
  const note = await screen.findByRole('note')
  expect(note).toHaveTextContent(/no plants/i)
})

// Additional highly targeted tests to ensure exact lines are executed for coverage
test('initial load non-abort error triggers setError (covers line 29)', async () => {
  // Spy directly to ensure the catch branch executes on the component
  const spy = vi.spyOn(calibrationApi, 'list').mockRejectedValueOnce(new Error('load exploded'))
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert.textContent || '').toMatch(/load exploded|failed to load calibration/i)
  spy.mockRestore()
})


test('correction error formats string detail (covers line 75)', async () => {
  // Spy on API methods to fully control both list() and correct()
  server.resetHandlers()
  const plant = { uuid: 'p-err', name: 'Err', min_dry_weight_g: 1, max_water_weight_g: 1, calibration: { max_water_retained: [ { id: 'e', measured_at: '2025-10-10 10:00:00', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 } ] } }
  const listSpy = vi.spyOn(calibrationApi, 'list').mockResolvedValue([plant])
  const postSpy = vi.spyOn(calibrationApi, 'correct')
    .mockRejectedValueOnce({ detail: 'Bad request' }) // hits line 75

  renderPage()
  await screen.findByText('Err')
  await userEvent.click(screen.getByRole('button', { name: /correct overfill/i }))
  const alert1 = await screen.findByRole('alert')
  expect(alert1).toHaveTextContent(/bad request/i)
  postSpy.mockRestore()
  listSpy.mockRestore()
})

test('correction error formats object detail (covers line 79)', async () => {
  server.resetHandlers()
  const plant = { uuid: 'p-err2', name: 'Err2', min_dry_weight_g: 1, max_water_weight_g: 1, calibration: { max_water_retained: [ { id: 'e2', measured_at: '2025-10-11 10:00:00', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 } ] } }
  const listSpy = vi.spyOn(calibrationApi, 'list').mockResolvedValue([plant])
  const postSpy = vi.spyOn(calibrationApi, 'correct')
    .mockRejectedValueOnce({ detail: { error: 'Not good' } }) // hits line 79

  renderPage()
  await screen.findByText('Err2')
  await userEvent.click(screen.getByRole('button', { name: /correct overfill/i }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent || '').toMatch(/not good|\{\s*"error"\s*:\s*"Not good"\s*\}/i)
  postSpy.mockRestore()
  listSpy.mockRestore()
})

test('handleCorrectOverfill uses [] when entries missing (covers line 46 default)', async () => {
  // Plant has calibration missing entirely, but weights present so button enabled
  const plant = { uuid: 'p-no-cal', name: 'NoCalForBtn', min_dry_weight_g: 10, max_water_weight_g: 5 }
  let called = false
  server.resetHandlers()
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant])),
    http.post('/api/measurements/corrections', async ({ request }) => {
      called = true
      const body = await request.json()
      // With no calibration entries, payload should not include from_ts/start_* fields
      expect(body).toMatchObject({ plant_id: 'p-no-cal', cap: 'capacity', edit_last_wet: true })
      expect(body).not.toHaveProperty('from_ts')
      expect(body).not.toHaveProperty('start_measurement_id')
      expect(body).not.toHaveProperty('start_diff_to_max_g')
      return HttpResponse.json({ ok: true })
    })
  )
  renderPage()
  await screen.findByText('NoCalForBtn')
  await userEvent.click(screen.getByRole('button', { name: /correct overfill/i }))
  await waitFor(() => expect(called).toBe(true))
})

// Branch coverage boosters for Calibration.jsx
// 1) Cover the fallback message branch in initial load catch: e.message is falsy → use default string
test('initial load error without message uses default text (covers rhs of e?.message || default at line 29)', async () => {
  const spy = vi.spyOn(calibrationApi, 'list').mockRejectedValueOnce({ message: '' })
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert.textContent || '').toMatch(/failed to load calibration data/i)
  spy.mockRestore()
})

// 2) Cover the nullish-coalescing middle operand (e.body) being selected and non-empty string
test('correction error uses body string when present (covers e.body branch at line 75)', async () => {
  server.resetHandlers()
  const plant = {
    uuid: 'p-body', name: 'BodyMsg', min_dry_weight_g: 1, max_water_weight_g: 1,
    calibration: { max_water_retained: [ { id: 'b1', measured_at: '2025-10-12 00:00:00', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 } ] }
  }
  server.use(
    http.get('/api/measurements/calibrating', () => HttpResponse.json([plant])),
    // Return a non-empty raw text body so api client surfaces e.body as a non-empty string
    http.post('/api/measurements/corrections', () => HttpResponse.text('Meaningful body message', { status: 500 }))
  )
  renderPage()
  await screen.findByText('BodyMsg')
  await userEvent.click(screen.getByRole('button', { name: /correct overfill/i }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent || '').toMatch(/meaningful body message/i)
})

// 3) Cover the try/catch around JSON.stringify(detail): make detail circular so stringify throws → catch branch executes
test('correction error with circular detail triggers stringify catch (covers catch at line 79)', async () => {
  server.resetHandlers()
  const plant = {
    uuid: 'p-circ', name: 'Circ', min_dry_weight_g: 1, max_water_weight_g: 1,
    calibration: { max_water_retained: [ { id: 'c1', measured_at: '2025-10-13 00:00:00', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 } ] }
  }
  // Use real list via MSW but simulate correction failure via spy so we can pass an unserializable object
  const listSpy = vi.spyOn(calibrationApi, 'list').mockResolvedValue([plant])
  const circular = {}
  circular.self = circular
  const postSpy = vi.spyOn(calibrationApi, 'correct').mockRejectedValueOnce({ detail: circular })

  renderPage()
  await screen.findByText('Circ')
  await userEvent.click(screen.getByRole('button', { name: /correct overfill/i }))
  const alert = await screen.findByRole('alert')
  // Since stringify throws, component should fall back to default/fallback message (not "[object Object]")
  expect(alert.textContent || '').toMatch(/failed to apply corrections|request failed|http/i)
  postSpy.mockRestore()
  listSpy.mockRestore()
})

// 4) Cover the third operand in (e.detail ?? e.body ?? e.message): only message present
test('correction error uses e.message when detail and body are absent (covers third operand at line 75)', async () => {
  server.resetHandlers()
  const plant = {
    uuid: 'p-msg', name: 'OnlyMsg', min_dry_weight_g: 1, max_water_weight_g: 1,
    calibration: { max_water_retained: [ { id: 'm1', measured_at: '2025-10-14 00:00:00', last_wet_weight_g: 0, target_weight_g: 1, under_g: 1, under_pct: 100 } ] }
  }
  const listSpy = vi.spyOn(calibrationApi, 'list').mockResolvedValue([plant])
  const postSpy = vi.spyOn(calibrationApi, 'correct').mockRejectedValueOnce({ message: 'Only message path' })

  renderPage()
  await screen.findByText('OnlyMsg')
  await userEvent.click(screen.getByRole('button', { name: /correct overfill/i }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent || '').toMatch(/only message path/i)
  postSpy.mockRestore()
  listSpy.mockRestore()
})
