import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantCreate from '../../../src/pages/PlantCreate.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { plantsApi } from '../../../src/api/plants'

// Mock navigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { __esModule: true, ...actual, useNavigate: () => mockNavigate }
})

function renderPage(initialEntries = ['/plants/new']) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={<PlantCreate />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/PlantCreate', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    // Default: provide locations list for select
    server.use(
      http.get('/api/locations', () => HttpResponse.json([
        { uuid: 'l1', name: 'Hall' },
        { uuid: 'l2', name: 'Kitchen' },
      ]))
    )
  })

  test('client-side validation: trimmed empty name shows error on General tab', async () => {
    const user = userEvent.setup()
    renderPage()
    const name = await screen.findByRole('textbox', { name: /name/i })
    await user.clear(name)
    await user.type(name, '   ')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()
  })

  test('successful save posts trimmed payload and navigates to /plants', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/plants', async ({ request }) => {
        const body = await request.json()
        // Check key fields are trimmed/converted
        expect(body).toEqual(expect.objectContaining({
          name: 'Ficus',
          location_id: 'l1',
          recommended_water_threshold_pct: null, // left empty -> null
        }))
        return HttpResponse.json({ uuid: 'p1', id: 1 }, { status: 201 })
      })
    )

    renderPage()
    await user.type(await screen.findByRole('textbox', { name: /name/i }), '  Ficus  ')
    await user.selectOptions(screen.getByLabelText(/location/i), 'l1')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })

  test('backend validation detail array maps to field error', async () => {
    const user = userEvent.setup()
    // Mock plantsApi.create to throw axios-like error structure
    const spy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      response: {
        data: {
          detail: [
            { loc: ['body', 'name'], msg: 'too short' }
          ]
        }
      }
    })

    renderPage()
    await user.type(await screen.findByRole('textbox', { name: /name/i }), 'x')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/too short/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('general error path shown when API fails without detail; locations load error rendered near select', async () => {
    const user = userEvent.setup()
    // Locations error
    server.use(
      http.get('/api/locations', () => HttpResponse.json({ message: 'loc fail' }, { status: 500 }))
    )
    // plants create returns 500 without axios-like shape (ApiClient -> ApiError)
    server.use(
      http.post('/api/plants', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    )

    renderPage()
    // locations error should be shown
    expect(await screen.findByText(/failed to load locations/i)).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'Ok')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    // General error for save appears
    expect(await screen.findByText(/failed to save plant/i)).toBeInTheDocument()
  })

  test('dark theme renders inputs with dark styles and tabs switch content', async () => {
    try { localStorage.setItem('theme', 'dark') } catch {}
    const user = userEvent.setup()
    renderPage()
    const name = await screen.findByRole('textbox', { name: /name/i })
    // Dark border color
    expect(name.style.border).toContain('rgb(68, 68, 68)')
    // Switch to Service tab and back
    await user.click(screen.getByRole('tab', { name: /service/i }))
    await user.click(screen.getByRole('tab', { name: /general/i }))
    expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument()
  })
})
