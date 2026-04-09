import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantsList from '../../../src/pages/PlantsList.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi, afterEach, test, expect } from 'vitest'

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
}

afterEach(() => {
  server.resetHandlers()
})

test('covers approximation success branches (lines 44-45, 51-60)', async () => {
  const plants = [
    { uuid: 'u1', name: 'Aloe', water_retained_pct: 20 },
    { uuid: 'u2', name: 'Monstera', water_retained_pct: 50 },
  ]
  const paginatedResponse = {
    items: plants,
    total: 2,
    page: 1,
    limit: 20,
    total_pages: 1
  }
  const approximation = {
    items: [
      {
        plant_uuid: 'u1',
        virtual_water_retained_pct: 25,
        frequency_days: 5,
        frequency_confidence: 0.8,
        next_watering_at: '2025-01-10T00:00:00',
        first_calculated_at: '2025-01-09T00:00:00',
        days_offset: 2,
      }
    ]
  }

  server.use(
    http.get('/api/plants', () => HttpResponse.json(paginatedResponse)),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json(approximation))
  )

  renderPage()

  // virtual_water_retained_pct 25 should be shown as 25% ONLY if in vacation mode
  const opMode = localStorage.getItem('operationMode') || 'manual'
  if (opMode === 'vacation') {
      await waitFor(() => {
          expect(screen.getByText('25%')).toBeInTheDocument()
      })
  } else {
      await waitFor(() => {
          expect(screen.getByText('20%')).toBeInTheDocument()
      })
  }

  // Verify frequency_days and frequency_confidence are rendered (line 311-325)
  expect(screen.getByText(/5 d/)).toBeInTheDocument()
  expect(screen.getByText(/\(0.8\)/)).toBeInTheDocument()
  expect(screen.getByText(/\(2d\)/)).toBeInTheDocument()

  // Monstera should still have its original data
  expect(screen.getByText('50%')).toBeInTheDocument()
})

test('covers approximation failure branch (lines 64-66)', async () => {
  const plants = [
    { uuid: 'u1', name: 'Aloe', water_retained_pct: 20 },
  ]
  const paginatedResponse = {
    items: plants,
    total: 1,
    page: 1,
    limit: 20,
    total_pages: 1
  }

  server.use(
    http.get('/api/plants', () => HttpResponse.json(paginatedResponse)),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ message: 'Error' }, { status: 500 }))
  )

  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  renderPage()

  // Wait for plants to load despite approximation failure
  await waitFor(() => {
    expect(screen.getByText('Aloe')).toBeInTheDocument()
  })

  // Original data should be used
  expect(screen.getByText('20%')).toBeInTheDocument()

  // Verify console.error was called (line 64)
  expect(consoleSpy).toHaveBeenCalledWith('Failed to load approximations', expect.anything())

  consoleSpy.mockRestore()
})

test('covers line 314 (vacation mode badge title) and line 375 (vacation mode missing next_watering_at)', async () => {
  localStorage.setItem('operationMode', 'vacation')
  const plants = [
    {
        uuid: 'u1',
        name: 'Aloe',
        water_retained_pct: 10,
        recommended_water_threshold_pct: 30,
        next_watering_at: null // This should trigger '—' on line 375 when in vacation mode
    },
  ]
  const paginatedResponse = {
    items: plants,
    total: 1,
    page: 1,
    limit: 20,
    total_pages: 1
  }
  const approximation = {
    items: [
      {
        plant_uuid: 'u1',
        virtual_water_retained_pct: 5, // < 30, so needsWater is true
        next_watering_at: null, // Ensure it is null here too
      }
    ]
  }

  server.use(
    http.get('/api/plants', () => HttpResponse.json(paginatedResponse)),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json(approximation))
  )

  try {
    renderPage()

    // Line 314: check badge title in vacation mode
    await waitFor(() => {
      const badge = screen.getByText('Needs water')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveAttribute('title', 'Needs water based on approximation')
    })

    // Line 375: check for '—' in the last column when in vacation mode and next_watering_at is null
    const row = screen.getByText('Aloe').closest('tr')
    const cells = within(row).getAllByRole('cell')
    // Last column is at index 7 (Location is 6, DateTime/Latest is 7)
    // Actually let's count: 
    // 0: Needs water/Retained
    // 1: Threshold
    // 2: Frequency
    // 3: Next watering
    // 4: Name
    // 5: Notes
    // 6: Location
    // 7: Latest/Approx datetime
    expect(cells[7]).toHaveTextContent('—')

  } finally {
    localStorage.removeItem('operationMode')
  }
})
