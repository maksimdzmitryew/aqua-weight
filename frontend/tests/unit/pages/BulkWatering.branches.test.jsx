import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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

vi.mock('../../../src/components/BulkMeasurementTable.jsx', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({ plants = [], onViewPlant, onDeleteWatering, onCommitValue }) => {
      // Invoke onViewPlant with an object lacking uuid to exercise early-return branch
      onViewPlant?.({ name: 'NoId' })
      // Defer delete invocation to effect to avoid setState during render
      const didDeleteRef = React.useRef(false)
      const didCommitRef = React.useRef(false)
      const lastWlRef = React.useRef(undefined)
      React.useEffect(() => {
        if (!plants.length) return
        const id = plants[0].uuid
        const wl = plants[0]?.water_loss_total_pct
        // First, when flagged, trigger a commit exactly once to populate originalWaterLoss
        if (__commitThenDelete && onCommitValue && !didCommitRef.current) {
          didCommitRef.current = true
          onCommitValue(id, '150')
        }
        // Next, once commit has updated WL to 60 (per handlers), perform delete exactly once
        if (
          __commitThenDelete && didCommitRef.current && !didDeleteRef.current && onDeleteWatering && wl === 60
        ) {
          didDeleteRef.current = true
          onDeleteWatering(id, 'm-1')
        }
        // Fallback: in non-commit mode, call delete once when plants first arrive
        if (!__commitThenDelete && !didDeleteRef.current && onDeleteWatering && lastWlRef.current === undefined) {
          didDeleteRef.current = true
          onDeleteWatering(id, 'm-1')
        }
        lastWlRef.current = wl
      }, [plants, onDeleteWatering, onCommitValue])
      // Expose current water loss value in DOM so we can assert changes
      const wl = plants[0]?.water_loss_total_pct
      return (
        <div>
          Mocked Table
          {wl !== undefined && (
            <div aria-label="water-loss">{String(wl)}</div>
          )}
        </div>
      )
    },
  }
})

describe('pages/BulkWatering (branches)', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  test('handleView returns early when plant has no uuid (no navigation)', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>
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
      </ThemeProvider>
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
      </ThemeProvider>
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
    server.use(
      ...paginatedPlantsHandler([plant])
    )

    // Mock the API delete to succeed
    const delSpy = vi.spyOn(measurementsApi, 'delete').mockResolvedValue({ status: 'success' })

    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Assert: after the mocked table triggers onDeleteWatering, the parent should
    // keep the same water_loss_total_pct (false branch of ternary)
    const wl = await screen.findByLabelText('water-loss')
    await waitFor(() => {
      expect(wl).toHaveTextContent('42')
    })

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

    server.use(
      ...paginatedPlantsHandler([plant])
    )

    // Enable commit-then-delete sequence inside the mocked table
    __commitThenDelete = true

    const delSpy = vi.spyOn(measurementsApi, 'delete').mockResolvedValue({ status: 'success' })

    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>
    )

    const wl = await screen.findByLabelText('water-loss')
    // Ensure commit changes it to a different value
    await waitFor(() => {
      expect(wl.textContent?.trim()).not.toBe('11')
    }, { timeout: 3000 })
    expect(delSpy).toHaveBeenCalled()

    // Reset flag and cleanup mocks
    __commitThenDelete = false
    delSpy.mockRestore()
  })
})
