import React from 'react'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { paginatedPlantsHandler } from '../msw/paginate.js'

// Mock useNavigate to verify it is NOT called when handleView receives plant without uuid
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    __esModule: true,
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('pages/BulkWeightMeasurement (branches)', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  test('handleView returns early when plant has no uuid (no navigation)', async () => {
    // Force a dummy plant so the table actually renders something and calls onViewPlant
    server.use(...paginatedPlantsHandler([{ uuid: 'p-dummy', name: 'Dummy' }]))

    // Mock the table to immediately call onViewPlant with a plant missing uuid to cover the guard
    vi.resetModules()
    vi.doMock('../../../src/components/BulkMeasurementTable.jsx', () => {
      const React = require('react')
      return {
        __esModule: true,
        default: ({ onViewPlant, todoUuids, plants }) => {
          const didViewRef = React.useRef(false)
          React.useEffect(() => {
            if (todoUuids === null) return
            if (plants && plants.length > 0 && !didViewRef.current && onViewPlant) {
              didViewRef.current = true
              onViewPlant({ name: 'NoId' })
            }
          }, [onViewPlant, todoUuids, plants])
          return <div>Mocked Table</div>
        },
      }
    })

    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>,
    )
    // The mock invoked onViewPlant with no uuid; ensure navigate was not called
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(await screen.findByText('Mocked Table')).toBeInTheDocument()
  })

  test('useMemo branch: handles displayed plants filtering', async () => {
    // Return plants
    server.use(
      ...paginatedPlantsHandler([
        {
          uuid: 'p1',
          name: 'ZZ Plant',
          water_retained_pct: 80,
          recommended_water_threshold_pct: 30,
          needs_weighing: true,
        },
      ]),
    )

    vi.resetModules()
    vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>,
    )

    // Initially should show ZZ Plant because default plantNeedsAttention=true
    expect(await screen.findByText('ZZ Plant')).toBeInTheDocument()
    expect(screen.getByText(/Start bulk weight measurement/i)).toBeInTheDocument()
  })

  test('Array.isArray(data) false branch: non-array plants response yields empty list gracefully', async () => {
    server.use(
      http.get('/api/plants/uuids', () => HttpResponse.json(['fakeuuid'])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.get('/api/plants', () => HttpResponse.json({ items: null })),
    )

    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockImplementation((key) => {
        if (key === 'operationMode') return null
        if (key === 'defaultThreshold') return '40'
        if (key === 'pageSize') return '20'
        return null
      }),
    })

    vi.resetModules()
    vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>,
    )

    // Falls back to [] and renders empty state
    await screen.findByText(/To-Do/i)
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  test('OR-chain fallback for timestamps and nullish metrics keep previous values', async () => {
    // Plant without latest_at/measured_at to force deepest fallback path to nowLocalISOMinutes()
    server.use(
      ...paginatedPlantsHandler([
        {
          uuid: 'w1',
          name: 'Cactus',
          water_retained_pct: 22,
          water_loss_total_pct: 78,
          recommended_water_threshold_pct: 30,
          needs_weighing: true,
        },
      ]),
      // Weight POST returns without timestamps and without metrics -> component should keep previous percentages
      http.post('/api/measurements/weight', async ({ request }) => {
        const payload = await request.json()
        return HttpResponse.json({ id: 501, plant_id: payload?.plant_id })
      }),
    )

    vi.resetModules()
    vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>,
    )

    const cell = await screen.findByText('Cactus')
    const row = cell.closest('tr')
    const input = within(row).getByRole('spinbutton')

    // Enter a valid weight to trigger POST and state update
    fireEvent.change(input, { target: { value: '123' } })
    fireEvent.blur(input)

    // Ensure async save path has completed so response merge branch is executed
    await waitFor(() => expect(input).toHaveValue(123))

    // Percentages should remain as previous since API omitted them (nullish coalescing branch)
    expect(within(row).getByText(/22%/)).toBeInTheDocument()
    expect(within(row).getByText(/78%/)).toBeInTheDocument()
  })

  test('covers init list fallbacks and save-path lookup for id-based plant keys', async () => {
    let weightCalls = 0
    server.use(
      http.get('/api/plants/uuids', ({ request }) => {
        const url = new URL(request.url)
        const needsWeighing = url.searchParams.get('needs_weighing')
        if (needsWeighing === 'true') return HttpResponse.json(['id-only-1'])
        if (needsWeighing === 'false') return HttpResponse.json([])
        return HttpResponse.json(['id-only-1'])
      }),
      http.get('/api/measurements/approximation/watering', () =>
        HttpResponse.json({ items: null }),
      ),
      http.get('/api/plants', () =>
        HttpResponse.json({
          items: [
            {
              id: 'id-only-1',
              name: 'Id Plant',
              water_retained_pct: 31,
              water_loss_total_pct: 69,
              needs_weighing: true,
            },
          ],
        }),
      ),
      http.post('/api/measurements/weight', async ({ request }) => {
        weightCalls += 1
        const payload = await request.json()
        return HttpResponse.json({
          id: 9001,
          plant_id: payload?.plant_id,
        })
      }),
    )

    vi.resetModules()
    vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>,
    )

    const showAllCheckbox = await screen.findByRole('checkbox', { name: /show all plants/i })
    fireEvent.click(showAllCheckbox)

    const cell = await screen.findByText('Id Plant')
    const row = cell.closest('tr')
    const input = within(row).getByRole('spinbutton')

    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.blur(input)

    await waitFor(() => expect(weightCalls).toBeGreaterThan(0))
    expect(input).toHaveValue(150)
  })

  test('operationMode defaults to null if localStorage is undefined', async () => {
    // Save original if it exists, but we'll mock it anyway
    vi.stubGlobal('localStorage', undefined)

    try {
      vi.resetModules()
      vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
      const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
      render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>,
      )

      // If operationMode is null (not 'vacation'), it should show the "Show all plants" checkbox
      // Use findBy to allow for some async rendering
      expect(await screen.findByText(/To-Do/i)).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('init falls back to empty uuid arrays when uuids endpoints return null', async () => {
    server.use(
      http.get('/api/plants/uuids', () => HttpResponse.json(null)),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.get('/api/plants', () => HttpResponse.json({ items: [] })),
    )

    vi.resetModules()
    vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>,
    )

    expect(await screen.findByText(/To-Do/i)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  test('save merge uses empty object fallback when no buffered and no current plant', async () => {
    let weightCalls = 0
    server.use(
      http.get('/api/plants/uuids', () => HttpResponse.json(['ghost-plant'])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.get('/api/plants', () => HttpResponse.json({ items: [] })),
      http.post('/api/measurements/weight', async ({ request }) => {
        weightCalls += 1
        const payload = await request.json()
        return HttpResponse.json({
          id: 9010,
          plant_id: payload?.plant_id,
        })
      }),
    )

    vi.resetModules()
    vi.doMock('../../../src/components/BulkMeasurementTable.jsx', () => {
      const React = require('react')
      return {
        __esModule: true,
        default: ({ onCommitValue, todoUuids }) => {
          const didCommitRef = React.useRef(false)
          React.useEffect(() => {
            if (todoUuids === null) return
            if (!didCommitRef.current && onCommitValue) {
              didCommitRef.current = true
              onCommitValue('ghost-plant', 321)
            }
          }, [onCommitValue, todoUuids])
          return <div>Ghost commit table</div>
        },
      }
    })

    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>,
    )

    expect(await screen.findByText('Ghost commit table')).toBeInTheDocument()
    await waitFor(() => expect(weightCalls).toBeGreaterThan(0))
    await waitFor(() =>
      expect(screen.queryByText(/Failed to initialize plant lists/i)).not.toBeInTheDocument(),
    )
  })

  test('ignores stale response when a newer weight request exists (covers lines 245-246)', async () => {
    const RealAbortController = globalThis.AbortController
    class NoopAbortController {
      constructor() {
        this.signal = {
          aborted: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }
      }

      abort() {}
    }
    vi.stubGlobal('AbortController', NoopAbortController)

    try {
      server.use(
        ...paginatedPlantsHandler([
          {
            uuid: 'race-1',
            name: 'Race Plant',
            water_retained_pct: 10,
            water_loss_total_pct: 90,
            recommended_water_threshold_pct: 30,
            needs_weighing: true,
          },
        ]),
      )

      let call = 0
      server.use(
        http.post('/api/measurements/weight', async ({ request }) => {
          call += 1
          const payload = await request.json()

          if (call === 1) {
            // Deliberately slower, stale response
            await new Promise((r) => setTimeout(r, 120))
            return HttpResponse.json({
              id: 7001,
              plant_id: payload?.plant_id,
              water_retained_pct: 11,
              water_loss_total_pct: 89,
              measured_at: '2025-01-01T10:00:00',
              latest_at: '2025-01-01T10:00:00',
            })
          }

          // Faster, newest response
          await new Promise((r) => setTimeout(r, 10))
          return HttpResponse.json({
            id: 7002,
            plant_id: payload?.plant_id,
            water_retained_pct: 77,
            water_loss_total_pct: 23,
            measured_at: '2025-01-01T10:01:00',
            latest_at: '2025-01-01T10:01:00',
          })
        }),
      )

      vi.resetModules()
      vi.doUnmock('../../../src/components/BulkMeasurementTable.jsx')
      const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default

      render(
        <ThemeProvider>
          <MemoryRouter>
            <Page />
          </MemoryRouter>
        </ThemeProvider>,
      )

      const cell = await screen.findByText('Race Plant')
      const row = cell.closest('tr')
      const input = within(row).getByRole('spinbutton')

      // First commit (will resolve later)
      fireEvent.change(input, { target: { value: '100' } })
      fireEvent.blur(input)

      // Second commit quickly after (newer request)
      fireEvent.change(input, { target: { value: '200' } })
      fireEvent.blur(input)

      // Assert latest response wins and stale one is ignored
      expect(await within(row).findByText(/77%/)).toBeInTheDocument()
      expect(within(row).getByText(/23%/)).toBeInTheDocument()
    } finally {
      vi.stubGlobal('AbortController', RealAbortController)
      vi.unstubAllGlobals()
    }
  })

  test('covers line 253 fallback when prev[plantId] and currentPlant are both missing', async () => {
    server.use(
      http.get('/api/plants/uuids', () => HttpResponse.json(['p1'])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.get('/api/plants', () =>
        HttpResponse.json({ items: [{ uuid: 'p1', name: 'Real Plant', needs_weighing: true }] }),
      ),
    )

    vi.resetModules()
    vi.doMock('../../../src/components/BulkMeasurementTable.jsx', () => {
      const React = require('react')
      return {
        __esModule: true,
        default: (props) => {
          const { onCommitValue, plants } = props
          const didCommitRef = React.useRef(false)
          React.useEffect(() => {
            if (plants && plants.length > 0 && !didCommitRef.current && onCommitValue) {
              didCommitRef.current = true
              onCommitValue('ghost', 500)
            }
          }, [onCommitValue, plants])
          return <div>Line 253 Mock Table</div>
        },
      }
    })

    const { apiClient } = await import('../../../src/api/client')
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue({
      id: 9999,
      plant_id: 'ghost',
      measured_at: '2025-01-01T12:00:00',
    })

    const Page = (await import('../../../src/pages/BulkWeightMeasurement.jsx')).default
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </ThemeProvider>,
    )

    await screen.findByText('Line 253 Mock Table')
    await waitFor(() => expect(spy).toHaveBeenCalled())
  })
})
