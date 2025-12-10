import React from 'react'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantDetails from '../../../src/pages/PlantDetails.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { measurementsApi } from '../../../src/api/measurements'
import { plantsApi } from '../../../src/api/plants'

// Mock navigate to observe navigations while keeping other router utilities
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { __esModule: true, ...actual, useNavigate: () => mockNavigate }
})

function renderWithRoute(initialEntries) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/plants/:uuid" element={<PlantDetails />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/PlantDetails', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    // Default measurements handler to avoid unhandled requests; individual tests may override
    server.use(
      http.get('/api/plants/:uuid/measurements', () => HttpResponse.json([]))
    )
  })

  test('loads from router state and shows actions (Edit and QuickCreate)', async () => {
    const init = {
      pathname: '/plants/u1',
      state: { plant: { uuid: 'u1', id: 1, name: 'Aloe', description: 'desc', created_at: '2025-01-01T00:00:00' } },
    }
    renderWithRoute([init])

    // Wait for Edit action and click it
    const editBtn = await screen.findByRole('button', { name: /edit/i })
    await userEvent.click(editBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/plants/u1/edit', expect.objectContaining({ state: expect.any(Object) }))
  })

  test('loads plant by uuid via API when no state and handles error', async () => {
    // Success path
    server.use(
      http.get('/api/plants/:uuid', ({ params }) => {
        expect(params.uuid).toBe('px')
        return HttpResponse.json({ uuid: 'px', id: 10, name: 'Loaded', created_at: '2025-01-02T00:00:00' })
      })
    )
    renderWithRoute(['/plants/px'])
    // After successful load, the Edit button should be visible (plant present)
    expect(await screen.findByRole('button', { name: /edit/i })).toBeInTheDocument()

    // Error path
    server.use(
      http.get('/api/plants/:uuid', () => HttpResponse.json({ message: 'not found' }, { status: 404 }))
    )
    renderWithRoute(['/plants/err'])
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load plant|not found/i)
  })

  test('missing uuid yields plant error immediately and does not fetch measurements', async () => {
    // Render component on a route that does not provide :uuid, so useParams().uuid is undefined
    const spy = vi.spyOn(measurementsApi, 'listByPlant')
    const view = render(
      <ThemeProvider>
        <MemoryRouter initialEntries={[{ pathname: '/' }] }>
          <Routes>
            <Route path="/" element={<PlantDetails />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/missing uuid/i)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    // Unmount to ensure cleanup does not throw
    view.unmount()
  })

  test('loads measurements, handles error with retry, and supports edit/delete actions', async () => {
    // Plant provided via router state
    const init = {
      pathname: '/plants/u9',
      state: { plant: { uuid: 'u9', id: 9, name: 'WithMeas', created_at: '2025-01-03T00:00:00' } },
    }

    // First, listByPlant returns two measurements
    server.use(
      http.get('/api/plants/:uuid/measurements', ({ params }) => {
        expect(params.uuid).toBe('u9')
        return HttpResponse.json([
          { id: 501, measured_at: '2025-01-05T12:00:00', measured_weight_g: 100, water_added_g: 0, water_loss_total_pct: 10 },
          { id: 502, measured_at: '2025-01-06T12:00:00', measured_weight_g: null, last_wet_weight_g: 200, water_added_g: 50, water_loss_day_pct: 3.5 },
        ])
      })
    )

    renderWithRoute([init])

    // Measurements table appears with two rows
    expect(await screen.findByRole('table')).toBeInTheDocument()
    const bodyRows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(bodyRows.length).toBe(2)

    // Edit navigation path depends on measured_weight_g
    await userEvent.click(within(bodyRows[0]).getByRole('button', { name: /edit measurement/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/measurement/weight?id=501')
    mockNavigate.mockClear()
    await userEvent.click(within(bodyRows[1]).getByRole('button', { name: /edit measurement/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/measurement/watering?id=502')

    // Delete opens dialog and calls DELETE then refetches
    const delBtn = within(bodyRows[0]).getByRole('button', { name: /delete measurement/i })
    // Spy delete and subsequent refetch
    let deleted = 0
    server.use(
      http.delete('/api/measurements/:id', ({ params }) => {
        deleted = Number(params.id)
        return HttpResponse.json({ ok: true })
      })
    )
    await userEvent.click(delBtn)
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(deleted).toBe(501))
  })

  test('measurements error shows ErrorNotice and retry reloads', async () => {
    const init = {
      pathname: '/plants/uu',
      state: { plant: { uuid: 'uu', id: 1, name: 'Err', created_at: '2025-01-01T00:00:00' } },
    }
    let called = 0
    server.use(
      http.get('/api/plants/:uuid/measurements', () => {
        called++
        if (called === 1) return HttpResponse.json({ message: 'boom' }, { status: 500 })
        return HttpResponse.json([])
      })
    )

    renderWithRoute([init])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/failed to load measurements|boom/i)
    // Click retry button on ErrorNotice if present
    const btn = within(alert.parentElement || document.body).getByRole('button', { name: /retry/i })
    await userEvent.click(btn)
    // After retry, empty state appears
    expect(await screen.findByRole('note')).toBeInTheDocument()
  })

  test('measurements error without message uses generic fallback', async () => {
    const init = {
      pathname: '/plants/uE2',
      state: { plant: { uuid: 'uE2', id: 2, name: 'Err2', created_at: '2025-01-01T00:00:00' } },
    }
    // Spy to reject with object lacking message to hit fallback branch in component
    const spy = vi.spyOn(measurementsApi, 'listByPlant').mockRejectedValueOnce({})
    renderWithRoute([init])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/failed to load measurements/i)
    spy.mockRestore()
  })

  test('delete confirmation without id closes dialog without calling API', async () => {
    const init = {
      pathname: '/plants/uX',
      state: { plant: { uuid: 'uX', id: 42, name: 'X' } },
    }
    // List with one row lacking id triggers missing-id branch upon delete
    server.use(
      http.get('/api/plants/:uuid/measurements', () => HttpResponse.json([{ measured_at: '2025-01-07T00:00:00' }]))
    )
    const delSpy = vi.fn()
    server.use(
      http.delete('/api/measurements/:id', () => {
        delSpy()
        return HttpResponse.json({ ok: true })
      })
    )
    renderWithRoute([init])
    const row = (await screen.findAllByRole('row')).slice(1)[0]
    // Edit with missing id should not navigate
    await userEvent.click(within(row).getByRole('button', { name: /edit measurement/i }))
    expect(mockNavigate).not.toHaveBeenCalled()
    // Delete path
    await userEvent.click(within(row).getByRole('button', { name: /delete measurement/i }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: /delete/i }))
    // No API call was made
    expect(delSpy).not.toHaveBeenCalled()
  })

  test('plant load abort on unmount does not surface an error', async () => {
    // Set handler that delays; unmount before it resolves so AbortController path is hit
    server.use(
      http.get('/api/plants/:uuid', async () => {
        await new Promise(r => setTimeout(r, 50))
        return HttpResponse.json({ uuid: 'ab', id: 1, name: 'Later' })
      })
    )
    const view = render(
      <ThemeProvider>
        <MemoryRouter initialEntries={[{ pathname: '/plants/ab' }] }>
          <Routes>
            <Route path="/plants/:uuid" element={<PlantDetails />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    )
    // Immediately unmount to trigger abort
    view.unmount()
    // Allow microtasks to flush so abort catch branch executes
    await new Promise(r => setTimeout(r, 10))
    // Nothing to assert; the absence of unhandled errors and test completion covers abort branch
  })

  test('plant load error with message containing "abort" is ignored (no error shown)', async () => {
    const spy = vi.spyOn(plantsApi, 'getByUuid').mockRejectedValueOnce({ message: 'Abort in flight' })
    renderWithRoute(['/plants/ab2'])
    // Wait for loading to finish; absence of alert indicates ignored error
    await screen.findByRole('button', { name: /edit/i }).catch(() => {})
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    spy.mockRestore()
  })

  test('plant load error named AbortError is ignored (no error shown)', async () => {
    const spy = vi.spyOn(plantsApi, 'getByUuid').mockRejectedValueOnce({ name: 'AbortError' })
    renderWithRoute(['/plants/ab3'])
    // Wait a tick
    await new Promise(r => setTimeout(r, 10))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    spy.mockRestore()
  })

  test('plant load error without message shows generic fallback', async () => {
    const spy = vi.spyOn(plantsApi, 'getByUuid').mockRejectedValueOnce({})
    renderWithRoute(['/plants/uNoMsg'])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/failed to load plant/i)
    spy.mockRestore()
  })

  test('delete API error is ignored and list refetches; dialog closes', async () => {
    const init = {
      pathname: '/plants/uErr',
      state: { plant: { uuid: 'uErr', id: 99, name: 'Err' } },
    }
    let listCalls = 0
    server.use(
      http.get('/api/plants/:uuid/measurements', ({ params }) => {
        if (params.uuid === 'uErr') listCalls++
        return HttpResponse.json([{ id: 1, measured_at: '2025-01-07T00:00:00', measured_weight_g: 1 }])
      }),
      http.delete('/api/measurements/:id', () => HttpResponse.json({ oops: true }, { status: 500 }))
    )

    renderWithRoute([init])

    const row = (await screen.findAllByRole('row')).slice(1)[0]
    await userEvent.click(within(row).getByRole('button', { name: /delete measurement/i }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: /delete/i }))

    // After failure, dialog should close and measurements should be refetched (listCalls increments)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2))
  })

  test('details fields and percent formatting branches: weights show units; pct string uses raw; null day pct shows —', async () => {
    const init = {
      pathname: '/plants/uFmt',
      state: { plant: { uuid: 'uFmt', id: 7, name: 'Format', description: '', location: '', min_dry_weight_g: 123, max_water_weight_g: 456, created_at: '2025-01-01T00:00:00' } },
    }
    // Return two measurements: first where total/day pct are strings (no toFixed); second where day pct is null
    server.use(
      http.get('/api/plants/:uuid/measurements', () =>
        HttpResponse.json([
          { id: 77, measured_at: '2025-01-08T00:00:00', measured_weight_g: 50, water_loss_total_pct: '7', water_loss_day_pct: '2' },
          { id: 78, measured_at: '2025-01-09T00:00:00', measured_weight_g: 60, water_loss_total_pct: 1, water_loss_day_pct: null },
        ])
      )
    )

    renderWithRoute([init])

    // Min/Max weight render with unit suffix
    expect(await screen.findByText('123g')).toBeInTheDocument()
    expect(screen.getByText('456g')).toBeInTheDocument()

    // Table rendered
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    const row = rows[1]
    const cells = within(row).getAllByRole('cell')
    // Index 6 is water_loss_total_pct column
    expect(cells[6]).toHaveTextContent('7%')
    // Index 8 is water_loss_day_pct column => em dash
    expect(cells[8]).toHaveTextContent('2%')
    // Second row has null day pct -> em dash
    const row2 = rows[2]
    const cells2 = within(row2).getAllByRole('cell')
    expect(cells2[8]).toHaveTextContent('—')

    // Also verify falsy branch for min/max weight renders em dash
    const init2 = {
      pathname: '/plants/uFmt2',
      state: { plant: { uuid: 'uFmt2', id: 8, name: 'Format2', min_dry_weight_g: 0, max_water_weight_g: 0, created_at: '2025-01-02T00:00:00' } },
    }
    server.use(
      http.get('/api/plants/:uuid/measurements', () => HttpResponse.json([]))
    )
    renderWithRoute([init2])
    // Empty state visible
    expect(await screen.findByRole('note')).toBeInTheDocument()
    // Two em dashes for min/max
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  test('header back button navigates to /plants', async () => {
    const init = {
      pathname: '/plants/uBack',
      state: { plant: { uuid: 'uBack', id: 1, name: 'Back', created_at: '2025-01-01T00:00:00' } },
    }
    server.use(http.get('/api/plants/:uuid/measurements', () => HttpResponse.json([])))
    renderWithRoute([init])
    const backBtn = await screen.findByRole('button', { name: /←\s*plants/i })
    await userEvent.click(backBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })

  test('measurements non-array response yields empty list gracefully', async () => {
    const init = {
      pathname: '/plants/uNonArr',
      state: { plant: { uuid: 'uNonArr', id: 5, name: 'NA' } },
    }
    server.use(
      http.get('/api/plants/:uuid/measurements', () => HttpResponse.json({ status: 'ok', data: { foo: 'bar' } }))
    )
    renderWithRoute([init])
    // Empty state appears (no table)
    expect(await screen.findByRole('note')).toBeInTheDocument()
  })
})
