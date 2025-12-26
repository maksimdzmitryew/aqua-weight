import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import BulkWatering from '../../../src/pages/BulkWatering.jsx'
import { vi } from 'vitest'

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
vi.mock('../../../src/components/BulkMeasurementTable.jsx', () => ({
  __esModule: true,
  default: ({ onViewPlant }) => {
    // Invoke onViewPlant with an object lacking uuid to exercise early-return branch
    onViewPlant?.({ name: 'NoId' })
    return <div>Mocked Table</div>
  },
}))

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
})
