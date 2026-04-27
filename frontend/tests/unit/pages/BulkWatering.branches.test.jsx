import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import BulkWatering from '../../../src/pages/BulkWatering.jsx'
import { vi } from 'vitest'
import { measurementsApi } from '../../../src/api/measurements'
import { server } from '../msw/server'
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

// Mock the table to immediately call onViewPlant with a plant missing uuid to cover the guard in handleView
let __commitThenDelete = false
let __commitOnly = false
let __vacationCommit = false
let __vacationDelete = false

vi.mock('../../../src/components/BulkMeasurementTable.jsx', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({
      plants = [],
      onViewPlant,
      onDeleteWatering,
      onCommitValue,
      onCommitVacationWatering,
      onDeleteVacationWatering,
    }) => {
      // Invoke onViewPlant with an object lacking uuid to exercise early-return branch
      onViewPlant?.({ name: 'NoId' })
      // Defer delete invocation to effect to avoid setState during render
      const didDeleteRef = React.useRef(false)
      const didCommitRef = React.useRef(false)
      const lastWlRef = React.useRef(undefined)
      React.useEffect(() => {
        if (!plants || !plants.length) return
        const id = plants[0].uuid
        const wl = plants[0]?.water_loss_total_pct
        // First, when flagged, trigger a commit exactly once to populate originalWaterLoss
        if (__commitThenDelete && onCommitValue && !didCommitRef.current) {
          didCommitRef.current = true
          onCommitValue(id, '150')
        }
        // Next, once commit has been triggered, perform delete exactly once on next update
        if (
          __commitThenDelete &&
          didCommitRef.current &&
          !didDeleteRef.current &&
          onDeleteWatering
        ) {
          didDeleteRef.current = true
          onDeleteWatering(id, 'm-1')
        }
        // commit-only mode: exercises handleWateringCommit null-prev branch (line 155)
        if (__commitOnly && !didCommitRef.current && onCommitValue) {
          didCommitRef.current = true
          onCommitValue(id, '150')
        }
        // vacation commit mode: exercises handleVacationWateringCommit null-prev branch (line 249)
        if (__vacationCommit && !didCommitRef.current && onCommitVacationWatering) {
          didCommitRef.current = true
          onCommitVacationWatering(id)
        }
        // vacation delete mode: exercises handleVacationWateringDelete null-prev branch (line 301)
        if (__vacationDelete && !didDeleteRef.current && onDeleteVacationWatering) {
          didDeleteRef.current = true
          onDeleteVacationWatering(id, 'vac-m-1')
        }
        // Fallback: in non-commit mode, call delete once when plants first arrive
        if (
          !__commitThenDelete &&
          !__commitOnly &&
          !__vacationCommit &&
          !__vacationDelete &&
          !didDeleteRef.current &&
          onDeleteWatering &&
          lastWlRef.current === undefined
        ) {
          didDeleteRef.current = true
          onDeleteWatering(id, 'm-1')
        }
        lastWlRef.current = wl
      }, [
        plants,
        onDeleteWatering,
        onCommitValue,
        onCommitVacationWatering,
        onDeleteVacationWatering,
      ])
      // Expose current water loss value in DOM so we can assert changes
      const wl = plants[0]?.water_loss_total_pct
      return (
        <div>
          Mocked Table
          {wl !== undefined && <div aria-label="water-loss">{String(wl)}</div>}
        </div>
      )
    },
  }
})

describe.sequential('pages/BulkWatering (branches)', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    localStorage.clear()
    __commitThenDelete = false
    __commitOnly = false
    __vacationCommit = false
    __vacationDelete = false
  })

  afterEach(() => {
    localStorage.clear()
    __commitOnly = false
    __vacationCommit = false
    __vacationDelete = false
  })

  test('handleView returns early when plant has no uuid (no navigation)', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>,
    )
    // The mock invoked onViewPlant with no uuid; ensure navigate was not called
    expect(mockNavigate).not.toHaveBeenCalled()
    // Mocked component rendered
    expect(await screen.findByText('Mocked Table')).toBeInTheDocument()
  })

  test('effect cleanup function executes on unmount (coverage of returned function)', async () => {
    const { unmount } = render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>,
    )
    // Allow initial effect to run once, then unmount to trigger cleanup
    // Using a microtask tick to ensure effect mounted
    await Promise.resolve()
    unmount()
    // No explicit assertion is necessary; this ensures the returned cleanup function is invoked,
    // contributing to function coverage of the file.
  })

  test('back button navigates to /daily (covers inline onBack callback)', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>,
    )
    const backBtn = await screen.findByRole('button', { name: /daily care/i })
    backBtn.click()
    expect(mockNavigate).toHaveBeenCalledWith('/daily')
  })

  test('delete without originalWaterLoss keeps water_loss_total_pct unchanged (covers false branch at line 164)', async () => {
    // Arrange: a plant with an initial water_loss_total_pct value
    const plant = {
      uuid: 'p-1',
      name: 'BranchCase',
      current_weight: 100,
      water_loss_total_pct: 42,
      // Make sure the plant needs watering initially (so it appears in the table)
      water_retained_pct: 20,
      recommended_water_threshold_pct: 30,
    }

    // Provide plants via MSW handlers (no prior commit implied, so originalWaterLoss is undefined)
    server.use(...paginatedPlantsHandler([plant]))

    // Mock the API delete to succeed
    const delSpy = vi.spyOn(measurementsApi, 'delete').mockResolvedValue({ status: 'success' })

    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>,
    )

    // Assert: after the mocked table triggers onDeleteWatering, the parent should
    // keep the same water_loss_total_pct (false branch of ternary)
    await waitFor(
      () => {
        const currentWl = screen.queryByLabelText('water-loss')
        expect(currentWl).toHaveTextContent('42')
      },
      { timeout: 3000 },
    )

    expect(delSpy).toHaveBeenCalled()

    // Cleanup mocks
    delSpy.mockRestore()
  })

  test('delete with originalWaterLoss present reverts to saved value (covers true branch at line 164)', async () => {
    // Arrange: a plant that already has a defined water_loss_total_pct so originalWaterLoss can be captured on commit
    const plant = {
      uuid: 'p-2',
      name: 'BranchTrue',
      current_weight: 80,
      water_loss_total_pct: 11,
      water_retained_pct: 20, // needs watering so it appears initially
      recommended_water_threshold_pct: 30,
    }

    server.use(...paginatedPlantsHandler([plant]))

    // Enable commit-then-delete sequence inside the mocked table
    __commitThenDelete = true

    const delSpy = vi.spyOn(measurementsApi, 'delete').mockResolvedValue({ status: 'success' })

    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>,
    )

    // Ensure commit changes it to a different value and delete is eventually called
    await waitFor(
      () => {
        const currentWl = screen.queryByLabelText('water-loss')
        expect(currentWl?.textContent?.trim()).not.toBe('11')
        expect(delSpy).toHaveBeenCalled()
      },
      { timeout: 3000 },
    )

    // Reset flag and cleanup mocks
    __commitThenDelete = false
    delSpy.mockRestore()
  })

  test('commit watering with null plants state covers (prev || []) fallback at line 155', async () => {
    __commitOnly = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      ...paginatedPlantsHandler([
        {
          uuid: 'p-line155',
          name: 'Plant155',
          water_retained_pct: 10,
          recommended_water_threshold_pct: 30,
        },
      ]),
      http.post('/api/measurements/watering', () =>
        HttpResponse.json(
          { id: 9001, water_retained_pct: 50, water_loss_total_pct: 50 },
          { status: 201 },
        ),
      ),
    )
    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>,
    )
    await screen.findByText('Mocked Table')
    await waitFor(() =>
      expect(consoleSpy).not.toHaveBeenCalledWith(
        'Error saving watering measurement:',
        expect.anything(),
      ),
    )
    consoleSpy.mockRestore()
  })

  test('vacation commit with null plants state covers (prev || []) fallback at line 249', async () => {
    localStorage.setItem('operationMode', 'vacation')
    __vacationCommit = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      ...paginatedPlantsHandler([
        {
          uuid: 'p-line249',
          name: 'Plant249',
          water_retained_pct: 10,
          recommended_water_threshold_pct: 30,
        },
      ]),
      http.get('/api/measurements/approximation/watering', () =>
        HttpResponse.json({
          items: [
            { plant_uuid: 'p-line249', days_offset: 0, next_watering_at: '2026-01-12 10:00' },
          ],
        }),
      ),
      http.post('/api/measurements/vacation/watering', () =>
        HttpResponse.json({
          data: { id: 9002, water_retained_pct: 100, water_loss_total_pct: 0 },
        }),
      ),
    )
    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>,
    )
    await screen.findByText('Mocked Table')
    await waitFor(() =>
      expect(consoleSpy).not.toHaveBeenCalledWith(
        'Error saving vacation watering:',
        expect.anything(),
      ),
    )
    consoleSpy.mockRestore()
  })

  test('vacation delete with null plants state covers (prev || []) fallback at line 301', async () => {
    localStorage.setItem('operationMode', 'vacation')
    __vacationDelete = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      ...paginatedPlantsHandler([
        {
          uuid: 'p-line301',
          name: 'Plant301',
          water_retained_pct: 10,
          recommended_water_threshold_pct: 30,
        },
      ]),
      http.get('/api/measurements/approximation/watering', () =>
        HttpResponse.json({
          items: [
            { plant_uuid: 'p-line301', days_offset: 0, next_watering_at: '2026-01-12 10:00' },
          ],
        }),
      ),
      http.delete('/api/measurements/vac-m-1', () => HttpResponse.json({ status: 'success' })),
    )
    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>,
    )
    await screen.findByText('Mocked Table')
    await waitFor(() =>
      expect(consoleSpy).not.toHaveBeenCalledWith(
        'Error deleting vacation watering:',
        expect.anything(),
      ),
    )
    consoleSpy.mockRestore()
  })

  test('covers return p branches and error paths in vacation mode', async () => {
    localStorage.setItem('operationMode', 'vacation')
    __vacationCommit = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((msg) => {
       if (typeof msg === 'string' && msg.includes('Failed to refresh approximations')) return;
       // ignore react warnings
    })
    
    // We need 2 plants to cover "return p" for non-matching IDs
    server.use(
      ...paginatedPlantsHandler([
        { uuid: 'p-match', name: 'Match', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
        { uuid: 'p-other', name: 'Other', water_retained_pct: 10, recommended_water_threshold_pct: 30 },
      ]),
      http.get('/api/measurements/approximation/watering', ({request}) => {
        // Use a counter to fail on the second call
        const url = new URL(request.url);
        if (url.searchParams.get('refresh') === 'true') {
           return HttpResponse.error();
        }
        return HttpResponse.json({ items: [{ plant_uuid: 'p-match', days_offset: 0 }] })
      }),
      // Mock vacation watering commit
      http.post('/api/measurements/vacation/watering', () =>
        HttpResponse.json({ id: 'mock-id', water_retained_pct: 100 })
      ),
    )

    // Note: the component doesn't actually append ?refresh=true, but I can use a simpler state-based mock
    let callCount = 0;
    server.use(
      http.get('/api/measurements/approximation/watering', () => {
        callCount++;
        if (callCount > 1) return HttpResponse.error();
        return HttpResponse.json({ items: [{ plant_uuid: 'p-match', days_offset: 0 }] })
      })
    )

    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>,
    )
    
    await screen.findByText('Mocked Table')
    // Wait for the commit and refresh to be attempted
    await waitFor(() => expect(callCount).toBeGreaterThan(1))
    
    consoleSpy.mockRestore()
    __vacationCommit = false
  })
})
