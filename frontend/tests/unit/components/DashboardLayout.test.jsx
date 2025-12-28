import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Mock the document title hook so we can assert calls without depending on its internals
vi.mock('../../../src/hooks/useDocumentTitle.js', () => ({
  __esModule: true,
  default: vi.fn(),
}))

import useDocumentTitle from '../../../src/hooks/useDocumentTitle.js'
import DashboardLayout from '../../../src/components/DashboardLayout.jsx'

function renderWithRoute(ui, { initialEntries = ['/dashboard'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      {/* Provide a route element so useLocation has a match and children can render */}
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>
  )
}

describe('DashboardLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Ensure a deterministic starting title for assertions if needed
    document.title = 'Initial'
  })

  it('renders provided title, sets document title via hook, and renders children', () => {
    const { container } = renderWithRoute(
      <DashboardLayout title="Plants">
        <div data-testid="child">Hello</div>
      </DashboardLayout>,
      { initialEntries: ['/plants'] }
    )

    // Sidebar title text (select the specific element by its class to avoid matching the nav link)
    const titleEl = container.querySelector('.sidebar-title')
    expect(titleEl).not.toBeNull()
    expect(titleEl?.textContent).toBe('Plants')

    // Hook is called with the provided title
    expect(useDocumentTitle).toHaveBeenCalledWith('Plants')

    // Children are rendered in the main area
    expect(screen.getByTestId('child')).toHaveTextContent('Hello')
  })

  it('highlights only the active nav link for current route (covers both branches)', () => {
    // On /dashboard, the Overview link should be active and others inactive
    renderWithRoute(<DashboardLayout title="Dashboard" />, {
      initialEntries: ['/dashboard'],
    })

    const overview = screen.getByRole('link', { name: 'Overview' })
    expect(overview).toHaveClass('nav-link', { exact: false })
    expect(overview).toHaveClass('active') // active branch true

    const plants = screen.getByRole('link', { name: 'Plants' })
    expect(plants).toHaveClass('nav-link')
    expect(plants).not.toHaveClass('active') // active branch false
  })

  it('renders back to home link with correct href', () => {
    renderWithRoute(<DashboardLayout title="Any" />)
    const back = screen.getByRole('link', { name: /Back to Home/i })
    expect(back).toHaveAttribute('href', '/')
  })

  it('uses default title when none is provided', () => {
    renderWithRoute(<DashboardLayout />)
    // Sidebar shows default title
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    // Hook called with default title
    expect(useDocumentTitle).toHaveBeenCalledWith('Dashboard')
  })

  it('renders vacation mode notice when operationMode is vacation', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue('vacation'),
    })

    renderWithRoute(<DashboardLayout />)
    expect(screen.getByRole('status')).toHaveTextContent(/Vacation mode/i)

    vi.unstubAllGlobals()
  })

  it('renders manual mode notice when operationMode is manual', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue('manual'),
    })

    renderWithRoute(<DashboardLayout />)
    expect(screen.getByRole('status')).toHaveTextContent(/Manual mode/i)

    vi.unstubAllGlobals()
  })

  it('renders no notice when operationMode is unknown', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue('unknown'),
    })

    renderWithRoute(<DashboardLayout />)
    expect(screen.queryByRole('status')).toBeNull()

    vi.unstubAllGlobals()
  })

  it('defaults to no notice when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined)

    renderWithRoute(<DashboardLayout />)
    // Should default to null and show no notice
    expect(screen.queryByRole('status')).toBeNull()

    vi.unstubAllGlobals()
  })
})
