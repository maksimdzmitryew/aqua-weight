import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
    http.get('/api/plants', () => HttpResponse.json(plants)),
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

  server.use(
    http.get('/api/plants', () => HttpResponse.json(plants)),
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
