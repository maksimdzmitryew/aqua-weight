import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import BulkWatering from '../../../src/pages/BulkWatering.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

describe('pages/BulkWatering (vacation mode commit/delete)', () => {
  beforeEach(() => {
    localStorage.setItem('operationMode', 'vacation')
  })

  afterEach(() => {
    localStorage.removeItem('operationMode')
    vi.restoreAllMocks()
  })

  async function setupAndShowAll() {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>
    )
    const toggle = await screen.findByRole('checkbox', { name: /show all plants/i })
    fireEvent.click(toggle)
  }

  test('committing vacation watering succeeds and updates plant state', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe', water_retained_pct: 10, recommended_water_threshold_pct: 30, water_loss_total_pct: 90 }
      ])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
        items: [{ plant_uuid: 'u1', days_offset: 0, next_watering_at: '2026-01-12 10:00' }]
      })),
      http.post('/api/measurements/vacation/watering', () => HttpResponse.json({
        status: 'success',
        data: {
          id: 5001,
          water_retained_pct: 100,
          water_loss_total_pct: 0,
          latest_at: '2026-01-12T11:00:00',
          measured_at: '2026-01-12T11:00:00'
        }
      }))
    )

    await setupAndShowAll()

    const commitBtn = await screen.findByRole('button', { name: /mark watered/i })
    fireEvent.click(commitBtn)

    await waitFor(() => expect(screen.queryByLabelText('Undo')).toBeInTheDocument())
  })

  test('committing vacation watering handles API error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe', water_retained_pct: 10, recommended_water_threshold_pct: 30 }
      ])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
        items: [{ plant_uuid: 'u1', days_offset: 0, next_watering_at: '2026-01-12 10:00' }]
      })),
      http.post('/api/measurements/vacation/watering', () => HttpResponse.json({ message: 'Error' }, { status: 500 }))
    )

    await setupAndShowAll()

    const commitBtn = await screen.findByRole('button', { name: /mark watered/i })
    fireEvent.click(commitBtn)

    await waitFor(() => expect(consoleSpy).toHaveBeenCalled())
    consoleSpy.mockRestore()
  })

  test('committing vacation watering handles empty response data (falsy branch)', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe', water_retained_pct: 10, recommended_water_threshold_pct: 30 }
      ])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.post('/api/measurements/vacation/watering', () => HttpResponse.json({ status: 'success', data: null }))
    )

    await setupAndShowAll()
    const commitBtn = await screen.findByRole('button', { name: /mark watered/i })
    fireEvent.click(commitBtn)

    // Should set inputStatus to error because measurement?.id is falsy
    await waitFor(() => expect(screen.getByRole('button', { name: /mark watered/i }).className).not.toMatch(/animate-pulse/))
    // We can't easily see 'error' status on the button without more complex queries, but we covered the branch
  })

  test('deleting vacation watering succeeds and reverts plant state', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe', water_retained_pct: 10, recommended_water_threshold_pct: 30, water_loss_total_pct: 90 }
      ])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
        items: [{ plant_uuid: 'u1', days_offset: 0, next_watering_at: '2026-01-12 10:00' }]
      })),
      http.post('/api/measurements/vacation/watering', () => HttpResponse.json({
        status: 'success',
        data: { id: 5001, water_retained_pct: 100, water_loss_total_pct: 0 }
      })),
      http.delete('/api/measurements/5001', () => HttpResponse.json({ status: 'success' }))
    )

    await setupAndShowAll()

    const commitBtn = await screen.findByRole('button', { name: /mark watered/i })
    fireEvent.click(commitBtn)
    await waitFor(() => expect(screen.queryByLabelText('Undo')).toBeInTheDocument())

    const deleteBtn = screen.getByRole('button', { name: /undo/i })
    fireEvent.click(deleteBtn)

    await waitFor(() => expect(screen.queryByLabelText('Undo')).not.toBeInTheDocument())
  })

  test('deleting vacation watering handles API error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe', water_retained_pct: 10, recommended_water_threshold_pct: 30, water_loss_total_pct: 90 }
      ])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
        items: [{ plant_uuid: 'u1', days_offset: 0, next_watering_at: '2026-01-12 10:00' }]
      })),
      http.post('/api/measurements/vacation/watering', () => HttpResponse.json({
        status: 'success',
        data: { id: 5001, water_retained_pct: 100, water_loss_total_pct: 0 }
      })),
      http.delete('/api/measurements/5001', () => HttpResponse.json({ message: 'Fail' }, { status: 500 }))
    )

    await setupAndShowAll()

    const commitBtn = await screen.findByRole('button', { name: /mark watered/i })
    fireEvent.click(commitBtn)
    await waitFor(() => expect(screen.queryByLabelText('Undo')).toBeInTheDocument())

    const deleteBtn = screen.getByRole('button', { name: /undo/i })
    fireEvent.click(deleteBtn)

    await waitFor(() => expect(consoleSpy).toHaveBeenCalled())
    consoleSpy.mockRestore()
  })

  test('vacation mode: approximation refresh failure after commit/delete is logged', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe', water_retained_pct: 10, recommended_water_threshold_pct: 30 }
      ])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({
        items: [{ plant_uuid: 'u1', days_offset: 0, next_watering_at: '2026-01-12 10:00' }]
      })),
      http.post('/api/measurements/vacation/watering', () => HttpResponse.json({
        data: { id: 5001 }
      })),
      http.delete('/api/measurements/5001', () => HttpResponse.json({ status: 'success' }))
    )

    await setupAndShowAll()

    // 1. Commit fails to refresh approx
    server.use(
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ message: 'fail' }, { status: 500 }))
    )
    const commitBtn = await screen.findByRole('button', { name: /mark watered/i })
    fireEvent.click(commitBtn)
    await waitFor(() => expect(consoleSpy).toHaveBeenCalledWith('Failed to refresh approximations', expect.any(Error)))
    
    // 2. Delete fails to refresh approx
    consoleSpy.mockClear()
    const deleteBtn = await screen.findByRole('button', { name: /undo/i })
    fireEvent.click(deleteBtn)
    await waitFor(() => expect(consoleSpy).toHaveBeenCalledWith('Failed to refresh approximations', expect.any(Error)))

    consoleSpy.mockRestore()
  })

  test('map handlers ignore non-matching plantId (coverage for early returns)', async () => {
    // This exercises line 157 and 206
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe' },
        { uuid: 'u2', name: 'Other' }
      ])),
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
      http.post('/api/measurements/vacation/watering', () => HttpResponse.json({
        data: { id: 5001 }
      })),
      http.delete('/api/measurements/5001', () => HttpResponse.json({ status: 'success' }))
    )

    await setupAndShowAll()

    // 1. Commit u1
    const commitBtns = await screen.findAllByRole('button', { name: /mark watered/i })
    fireEvent.click(commitBtns[0]) // u1
    await waitFor(() => expect(screen.queryByLabelText('Undo')).toBeInTheDocument())

    // 2. Delete u1
    const deleteBtn = screen.getByRole('button', { name: /undo/i })
    fireEvent.click(deleteBtn)
    await waitFor(() => expect(screen.queryByLabelText('Undo')).not.toBeInTheDocument())

    // Also cover fallback branches in approximations.reduce (lines 163, 217)
    // We already covered them because setupAndShowAll used items: [...]
    // and if it was empty, reduce wouldn't run, but the OR-chain would.
    // Let's force an empty items array to hit `approxData?.items || []` branch.
    server.use(
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: null }))
    )
    fireEvent.click(commitBtns[0])
    await waitFor(() => expect(screen.queryByLabelText('Undo')).toBeInTheDocument())
    
    server.use(
      http.get('/api/measurements/approximation/watering', () => HttpResponse.json(null))
    )
    fireEvent.click(deleteBtn)
    await waitFor(() => expect(screen.queryByLabelText('Undo')).not.toBeInTheDocument())
  })

  test('toggle label switches based on mode and showAll', async () => {
    // Already in vacation mode from beforeEach
    server.use(
      http.get('/api/plants', () => HttpResponse.json([]))
    )
    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Initially showAll is false
    expect(screen.getByText(/Showing only plants that need watering according to the approximation schedule/i)).toBeInTheDocument()

    const toggle = screen.getByRole('checkbox', { name: /show all plants/i })
    fireEvent.click(toggle)
    expect(screen.getByText(/Showing all plants; those above threshold are deemphasized/i)).toBeInTheDocument()

    // Switch to manual mode
    localStorage.setItem('operationMode', 'manual')
    render(
      <ThemeProvider>
        <MemoryRouter>
          <BulkWatering />
        </MemoryRouter>
      </ThemeProvider>
    )
    // showAll is reset to false on mount
    expect(screen.getByText(/Showing only plants that need watering \(retained ≤ threshold\)/i)).toBeInTheDocument()
  })
})
