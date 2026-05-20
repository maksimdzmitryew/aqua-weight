import React from 'react'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import BulkWeightMeasurement from '../../../src/pages/BulkWeightMeasurement.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { paginatedPlantsHandler } from '../msw/paginate.js'
import { measurementsApi } from '../../../src/api/measurements'

// Mock navigation to verify handleView
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    __esModule: true,
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../../../src/components/feedback/EmptyState.jsx', () => ({
  default: ({ title, description }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <div>{description}</div>
    </div>
  ),
}))

function renderPage(mode = null, initialEntries = ['/'], componentProps = {}) {
  if (mode) {
    localStorage.setItem('operationMode', mode)
  } else {
    localStorage.removeItem('operationMode')
  }
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <BulkWeightMeasurement {...componentProps} />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('pages/BulkWeightMeasurement', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })
  test('default shows all plants that need attention (all in manual mode)', async () => {
    // Both plants have needs_weighing: true implicitly from paginatedPlantsHandler
    // or we can set them explicitly if we suspect they default to false
    server.use(
      ...paginatedPlantsHandler([
        { uuid: 'u1', name: 'Aloe', needs_weighing: true },
        { uuid: 'u2', name: 'Monstera', needs_weighing: true },
      ]),
    )
    renderPage()

    // Default showAll = false -> initially shows all plants (Aloe and Monstera)
    // because they are both in the To-Do snapshot
    expect(await screen.findByText('Aloe')).toBeInTheDocument()
    expect(await screen.findByText('Monstera')).toBeInTheDocument()

    // Verify buttons for tabs are present
    expect(screen.getByRole('button', { name: /to-do/i })).toBeInTheDocument()
  })

  test('toggling "Show all plants" checkbox changes visibility', async () => {
    // Custom handlers to have one plant that needs weighing and one that doesn't
    server.use(
      ...paginatedPlantsHandler([
        { uuid: 'u1', name: 'Needs Weighing', needs_weighing: true },
        { uuid: 'u2', name: 'Full Water', needs_weighing: false },
      ]),
    )

    renderPage()
    // Wait for data to load
    expect(await screen.findByText(/Needs Weighing/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/Full Water/i)).not.toBeInTheDocument())

    // Toggle "Show all plants" checkbox
    const checkbox = screen.getByRole('checkbox', { name: /show all plants/i })
    fireEvent.click(checkbox)

    // Now both should be visible
    expect(await screen.findByText('Full Water')).toBeInTheDocument()
    expect(screen.getByText('Needs Weighing')).toBeInTheDocument()

    // Toggle back
    fireEvent.click(checkbox)
    await waitFor(() => expect(screen.queryByText('Full Water')).not.toBeInTheDocument())
    expect(screen.getByText('Needs Weighing')).toBeInTheDocument()
  })

  test('committing weight creates then updates measurement; invalid negative marks error', async () => {
    // Handlers for weight endpoints
    server.use(
      http.post('/api/measurements/weight', async ({ request }) => {
        const payload = await request.json()
        return HttpResponse.json({
          id: 2001,
          plant_id: payload?.plant_id,
          measured_at: payload?.measured_at || '2025-01-03T00:00:00',
          latest_at: payload?.measured_at || '2025-01-03T00:00:00',
          water_retained_pct: 35,
          water_loss_total_pct: 65,
        })
      }),
      http.put('/api/measurements/weight/:id', async ({ request, params }) => {
        const payload = await request.json()
        return HttpResponse.json({
          id: Number(params.id) || 2001,
          plant_id: payload?.plant_id,
          measured_at: payload?.measured_at || '2025-01-04T00:00:00',
          latest_at: payload?.measured_at || '2025-01-04T00:00:00',
          water_retained_pct: 37,
          water_loss_total_pct: 63,
        })
      }),
    )

    renderPage()

    // Work with Aloe row
    const aloeCell = await screen.findByText('Aloe')
    const row = aloeCell.closest('tr')
    const input = within(row).getByRole('spinbutton')

    // Negative → error on blur
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '-1' } })
    fireEvent.blur(input)
    expect(input.className).toMatch(/bg-error/)

    // Valid number → create → retained 35%
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '100' } })
    fireEvent.blur(input)
    expect(await within(row).findByText(/35%/)).toBeInTheDocument()

    // Second commit → update → retained 37%
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '101' } })
    fireEvent.blur(input)
    await waitFor(() => expect(within(row).queryByText(/37%/)).toBeInTheDocument())
  })

  test('ignores stale weight response when a newer commit was sent for the same plant', async () => {
    const createSpy = vi.spyOn(measurementsApi.weight, 'create')
    try {
      let callIndex = 0
      createSpy.mockImplementation(async (payload) => {
        callIndex += 1

        if (callIndex === 1) {
          await new Promise((resolve) => setTimeout(resolve, 120))
          return {
            id: 4101,
            plant_id: payload?.plant_id,
            measured_at: payload?.measured_at || '2025-01-10T00:00:00',
            latest_at: payload?.measured_at || '2025-01-10T00:00:00',
            water_retained_pct: 10,
            water_loss_total_pct: 90,
          }
        }

        return {
          id: 4102,
          plant_id: payload?.plant_id,
          measured_at: payload?.measured_at || '2025-01-10T00:00:01',
          latest_at: payload?.measured_at || '2025-01-10T00:00:01',
          water_retained_pct: 55,
          water_loss_total_pct: 45,
        }
      })

      renderPage()

      const aloeCell = await screen.findByText('Aloe')
      const row = aloeCell.closest('tr')
      const input = within(row).getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '100' } })
      fireEvent.blur(input)

      fireEvent.click(input)
      fireEvent.change(input, { target: { value: '101' } })
      fireEvent.blur(input)

      await waitFor(() => expect(within(row).queryByText(/55%/)).toBeInTheDocument())

      // Wait until the slower stale response resolves and ensure it did not overwrite newer state
      await waitFor(
        () => {
          expect(callIndex).toBe(2)
          expect(within(row).queryByText(/10%/)).not.toBeInTheDocument()
        },
        { timeout: 1000 },
      )
    } finally {
      createSpy.mockRestore()
    }
  })

  test('shows error when plants API fails', async () => {
    server.use(
      http.get('/api/plants/uuids', () =>
        HttpResponse.json({ message: 'failed to load plants' }, { status: 500 }),
      ),
    )
    renderPage()
    expect(await screen.findByText(/failed to initialize plant lists/i)).toBeInTheDocument()
  })

  test('clicking plant name navigates using handleView', async () => {
    renderPage()
    const aloe = await screen.findByText('Aloe')
    fireEvent.click(aloe)
    expect(mockNavigate).toHaveBeenCalledWith(
      '/plants/u1',
      expect.objectContaining({ state: expect.any(Object) }),
    )
  })

  test('back button navigates to /daily (covers inline onBack callback)', async () => {
    renderPage()
    const backBtn = await screen.findByRole('button', { name: /daily care/i })
    fireEvent.click(backBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/daily')
  })

  test('shows explanation and link to settings in vacation mode', async () => {
    renderPage('vacation')

    const emptyState = await screen.findByTestId('empty-state')
    expect(emptyState).toBeInTheDocument()
    expect(screen.getByText(/Not available in Vacation mode/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Bulk weight measurement is disabled while in vacation mode/i),
    ).toBeInTheDocument()

    const settingsLink = within(emptyState).getByRole('link', { name: /Settings/i })
    expect(settingsLink).toBeInTheDocument()
    expect(settingsLink.getAttribute('href')).toBe('/settings')

    // Table should not be present
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('handles wrapped {status,data} response and logs error on update failure', async () => {
    // Wrap POST response for weight
    server.use(
      http.post('/api/measurements/weight', async ({ request }) => {
        const payload = await request.json()
        return HttpResponse.json(
          {
            status: 'success',
            data: {
              id: 3001,
              plant_id: payload?.plant_id,
              measured_at: payload?.measured_at || '2025-01-06T00:00:00',
              latest_at: payload?.measured_at || '2025-01-06T00:00:00',
              water_retained_pct: 44,
              water_loss_total_pct: 56,
            },
          },
          { status: 201 },
        )
      }),
    )

    renderPage()

    const aloeCell = await screen.findByText('Aloe')
    const row = aloeCell.closest('tr')
    const input = within(row).getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '200' } })
    fireEvent.blur(input)
    expect(await within(row).findByText(/44%/)).toBeInTheDocument()

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      http.put('/api/measurements/weight/:id', () =>
        HttpResponse.json({ message: 'fail' }, { status: 500 }),
      ),
    )

    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '201' } })
    fireEvent.blur(input)
    await waitFor(() => expect(errSpy).toHaveBeenCalled())
    errSpy.mockRestore()
  })

  test('covers tab switching, page change, limit change and empty messages', async () => {
    server.use(
      http.get('/api/plants/uuids', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('needs_weighing') === 'true') {
          return HttpResponse.json(['u1', 'u2', 'u3'])
        } else if (url.searchParams.get('needs_weighing') === 'false') {
          return HttpResponse.json(['u4'])
        }
        return HttpResponse.json(['u1', 'u2', 'u3', 'u4'])
      }),
      http.get('/api/measurements/approximation/watering', () =>
        HttpResponse.json({
          items: [
            { plant_uuid: 'u1', next_watering_at: '2025-01-01T00:00:00' },
            { plant_uuid: 'u2', next_watering_at: '2025-01-02T00:00:00' },
          ],
        }),
      ),
      ...paginatedPlantsHandler([
        { uuid: 'u1', name: 'Plant 1', needs_weighing: true },
        { uuid: 'u2', name: 'Plant 2', needs_weighing: true },
      ]),
    )

    renderPage()

    // 1. handleTabChange and totalCount (lines 162-163, 169-173)
    await screen.findByRole('button', { name: /to-do \(3\)/i })

    const upToDateTab = screen.getByRole('button', { name: /up to date/i })
    fireEvent.click(upToDateTab)
    await screen.findByRole('button', { name: /up to date \(1\)/i })

    const allTab = screen.getByRole('button', { name: /all/i })
    fireEvent.click(allTab)
    await screen.findByRole('button', { name: /all \(4\)/i })

    // 2. handlePageChange (lines 176-183)
    // In All tab, we have 4 items, limit 20, but let's force pagination by setting limit small
    fireEvent.click(screen.getByRole('button', { name: /to-do/i }))

    // 3. handleLimitChange (lines 186-199)
    // Find the pageSize select and change it
    const limitSelect = screen.getByLabelText(/per page:/i)
    fireEvent.change(limitSelect, { target: { value: '10' } })
    expect(localStorage.getItem('pageSize')).toBe('10')

    // Now test handlePageChange by clicking next page (if available)
    // With 3 items and limit 10, we don't have next page. Let's use limit 2.
    fireEvent.change(limitSelect, { target: { value: '2' } })
    const nextBtn = screen.getByRole('button', { name: /next page/i })
    fireEvent.click(nextBtn)

    // 4. noPlantsMessage for Done/All (lines 372-374)
    server.use(
      http.get('/api/plants/uuids', () => HttpResponse.json([])),
      ...paginatedPlantsHandler([]),
    )
    fireEvent.click(upToDateTab)
    expect(await screen.findByText(/no plants to show/i)).toBeInTheDocument()

    fireEvent.click(allTab)
    expect(await screen.findByText(/no plants available/i)).toBeInTheDocument()
  })

  test('shows error when current page data request fails', async () => {
    let plantsCalls = 0
    server.use(
      http.get('/api/plants/uuids', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('needs_weighing') === 'true') {
          return HttpResponse.json(Array.from({ length: 11 }, (_, i) => `u${i + 1}`))
        }
        if (url.searchParams.get('needs_weighing') === 'false') return HttpResponse.json([])
        return HttpResponse.json(Array.from({ length: 11 }, (_, i) => `u${i + 1}`))
      }),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.get('/api/plants', ({ request }) => {
        plantsCalls += 1
        if (plantsCalls >= 2) {
          return HttpResponse.json({ message: 'forced fail' }, { status: 500 })
        }

        const url = new URL(request.url)
        const uuids = (url.searchParams.get('uuids') || '').split(',').filter(Boolean)
        return HttpResponse.json({
          items: uuids.map((uuid) => ({ uuid, name: `Plant ${uuid}`, needs_weighing: true })),
        })
      }),
    )

    renderPage(null, ['/?limit=10&page_todo=1'])
    await screen.findByText('Plant u1')
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))

    expect(await screen.findByText(/failed to load page data/i)).toBeInTheDocument()
  })

  test('covers filteredPlants fallback on non-TODO tab before snapshots are ready', async () => {
    server.use(
      http.get('/api/plants/uuids', async ({ request }) => {
        await new Promise((resolve) => setTimeout(resolve, 40))
        const url = new URL(request.url)
        if (url.searchParams.get('needs_weighing') === 'true') return HttpResponse.json(['u1'])
        if (url.searchParams.get('needs_weighing') === 'false') return HttpResponse.json(['u2'])
        return HttpResponse.json(['u1', 'u2'])
      }),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.get('/api/plants', () =>
        HttpResponse.json({
          items: [
            { uuid: 'u1', name: 'Plant 1', needs_weighing: true },
            { uuid: 'u2', name: 'Plant 2', needs_weighing: false },
          ],
        }),
      ),
    )

    renderPage(null, ['/?tab=done'])
    expect(await screen.findByRole('button', { name: /up to date \(1\)/i })).toBeInTheDocument()
  })

  test('handlePageChange uses done/all page keys', async () => {
    const doneUuids = Array.from({ length: 11 }, (_, i) => `d${i + 1}`)
    const allUuids = [...doneUuids]

    server.use(
      http.get('/api/plants/uuids', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('needs_weighing') === 'true') return HttpResponse.json([])
        if (url.searchParams.get('needs_weighing') === 'false') return HttpResponse.json(doneUuids)
        return HttpResponse.json(allUuids)
      }),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.get('/api/plants', ({ request }) => {
        const url = new URL(request.url)
        const uuids = (url.searchParams.get('uuids') || '').split(',').filter(Boolean)
        return HttpResponse.json({
          items: uuids.map((uuid) => ({ uuid, name: `Plant ${uuid}`, needs_weighing: false })),
        })
      }),
    )

    renderPage(null, ['/?tab=done&limit=10&page_done=1&page_all=1'])

    expect(await screen.findByRole('button', { name: /up to date \(11\)/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(
      await screen.findByRole('button', { name: /page 2/i, current: 'page' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /all/i }))
    expect(await screen.findByRole('button', { name: /all \(11\)/i })).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: /page 1/i, current: 'page' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(
      await screen.findByRole('button', { name: /page 2/i, current: 'page' }),
    ).toBeInTheDocument()
  })

  test('covers init fallback branches and ALL totalCount branch with injectable client', async () => {
    const client = {
      get: vi.fn(async (path) => {
        if (path.startsWith('/plants/uuids?needs_weighing=true')) return null
        if (path.startsWith('/plants/uuids?needs_weighing=false')) return null
        if (path.startsWith('/plants/uuids?operationMode=')) return null
        if (path === '/measurements/approximation/watering') return null
        if (path.startsWith('/plants?')) return { items: [] }
        return null
      }),
    }

    renderPage(null, ['/?tab=all'], { client })

    expect(await screen.findByRole('button', { name: /all/i })).toBeInTheDocument()
    expect(screen.getByText(/no plants available/i)).toBeInTheDocument()
  })

  test('covers plants.items fallback to empty array for current page response', async () => {
    server.use(
      http.get('/api/plants/uuids', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('needs_weighing') === 'true') return HttpResponse.json(['u1'])
        if (url.searchParams.get('needs_weighing') === 'false') return HttpResponse.json([])
        return HttpResponse.json(['u1'])
      }),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.get('/api/plants', () => HttpResponse.json({})),
    )

    renderPage(null, ['/?page_todo=1&limit=20'])

    expect(await screen.findByRole('button', { name: /to-do \(1\)/i })).toBeInTheDocument()
    expect(await screen.findByText(/no plants need weighing/i)).toBeInTheDocument()
    expect(screen.queryByText('u1')).not.toBeInTheDocument()
  })
})
