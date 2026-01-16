import React from 'react'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import BulkWeightMeasurement from '../../../src/pages/BulkWeightMeasurement.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

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
  )
}))

function renderPage(mode = null) {
  if (mode) {
    localStorage.setItem('operationMode', mode)
  } else {
    localStorage.removeItem('operationMode')
  }
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <BulkWeightMeasurement />
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/BulkWeightMeasurement', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })
  test('default shows all plants that need attention (all in manual mode)', async () => {
    renderPage()

    // Default showAll = false -> initially shows all plants (Aloe and Monstera) 
    // because in manual mode plantNeedsAttention returns true for all
    expect(await screen.findByText('Aloe')).toBeInTheDocument()
    expect(screen.getByText('Monstera')).toBeInTheDocument()

    // Verify hint text correctly refers to weighing and is accurate
    expect(screen.getByText(/Showing all plants that need weighing/i)).toBeInTheDocument()
  })

  test('toggling "Show all plants" checkbox changes visibility', async () => {
    // Custom handlers to have one plant that needs weighing and one that doesn't
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Needs Weighing', needs_weighing: true },
        { uuid: 'u2', name: 'Full Water', needs_weighing: false }
      ]))
    )

    renderPage()

    // Initially showAll = false -> only Needs Weighing
    expect(await screen.findByText('Needs Weighing')).toBeInTheDocument()
    expect(screen.queryByText('Full Water')).not.toBeInTheDocument()

    // Toggle "Show all plants"
    const toggle = screen.getByRole('checkbox', { name: /show all plants/i })
    fireEvent.click(toggle)

    // Now both should be visible
    expect(await screen.findByText('Full Water')).toBeInTheDocument()
    expect(screen.getByText('Needs Weighing')).toBeInTheDocument()

    // Toggle back
    fireEvent.click(toggle)
    expect(screen.queryByText('Full Water')).not.toBeInTheDocument()
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
      })
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
    expect(await within(row).findByText(/37%/)).toBeInTheDocument()
  })

  test('shows error when plants API fails', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ message: 'nope' }, { status: 500 }))
    )
    renderPage()
    expect(await screen.findByText(/failed to load plants/i)).toBeInTheDocument()
  })

  test('clicking plant name navigates using handleView', async () => {
    renderPage()
    const aloe = await screen.findByText('Aloe')
    fireEvent.click(aloe)
    expect(mockNavigate).toHaveBeenCalledWith('/plants/u1', expect.objectContaining({ state: expect.any(Object) }))
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
    expect(screen.getByText(/Bulk weight measurement is disabled while in vacation mode/i)).toBeInTheDocument()
    
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
        return HttpResponse.json({
          status: 'success',
          data: {
            id: 3001,
            plant_id: payload?.plant_id,
            measured_at: payload?.measured_at || '2025-01-06T00:00:00',
            latest_at: payload?.measured_at || '2025-01-06T00:00:00',
            water_retained_pct: 44,
            water_loss_total_pct: 56,
          },
        }, { status: 201 })
      })
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
      http.put('/api/measurements/weight/:id', () => HttpResponse.json({ message: 'fail' }, { status: 500 }))
    )

    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '201' } })
    fireEvent.blur(input)
    await waitFor(() => expect(errSpy).toHaveBeenCalled())
    errSpy.mockRestore()
  })
})
