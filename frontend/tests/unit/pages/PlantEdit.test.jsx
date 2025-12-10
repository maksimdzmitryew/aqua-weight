import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantEdit from '../../../src/pages/PlantEdit.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

// Mock navigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { __esModule: true, ...actual, useNavigate: () => mockNavigate }
})

function renderWithRoute(initialEntries) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/plants/:uuid/edit" element={<PlantEdit />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/PlantEdit', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
  })

  test('prefills from router state, trims name on save, PUTs and navigates', async () => {
    const init = {
      pathname: '/plants/u1/edit',
      state: { plant: { uuid: 'u1', name: 'Old', description: 'd' } },
    }
    let called = false
    server.use(
      http.put('/api/plants/:uuid', async ({ params, request }) => {
        expect(params.uuid).toBe('u1')
        const body = await request.json()
        expect(body.name).toBe('New')
        called = true
        return HttpResponse.json({ ok: true })
      }),
      http.get('/api/locations', () => HttpResponse.json([{ uuid: 'l1', name: 'Hall' }]))
    )

    renderWithRoute([init])

    const name = await screen.findByRole('textbox', { name: /name/i })
    await userEvent.clear(name)
    await userEvent.type(name, '  New  ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(called).toBe(true)
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })

  test('loads via API when no state provided; shows loading then form', async () => {
    server.use(
      http.get('/api/plants/:uuid', ({ params }) => HttpResponse.json({ uuid: params.uuid, name: 'Loaded' })),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/u2/edit'])
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Loaded')).toBeInTheDocument()
  })

  test('locations load error is shown near select', async () => {
    server.use(
      http.get('/api/plants/:uuid', ({ params }) => HttpResponse.json({ uuid: params.uuid, name: 'P' })),
      http.get('/api/locations', () => HttpResponse.json({ message: 'fail' }, { status: 500 }))
    )
    renderWithRoute(['/plants/u3/edit'])
    expect(await screen.findByText(/failed to load locations/i)).toBeInTheDocument()
  })

  test('load error shows generic error message when API fails', async () => {
    server.use(
      http.get('/api/plants/:uuid', () => HttpResponse.text('nope', { status: 500 })),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uErr/edit'])
    // Loading first, then error after request fails
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(/failed to load plant/i)).toBeInTheDocument()
  })

  test('missing uuid on save alerts error', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    // Use a matching route but provide state without uuid to trigger branch inside onSave
    const init = { pathname: '/plants/any/edit', state: { plant: { name: 'NoId' } } }
    // locations
    server.use(
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute([init])
    await userEvent.click(await screen.findByRole('button', { name: /save/i }))
    expect(alertSpy).toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  test('dark theme styles and tabs switch', async () => {
    try { localStorage.setItem('theme', 'dark') } catch {}
    const init = { pathname: '/plants/u4/edit', state: { plant: { uuid: 'u4', name: 'Dark' } } }
    server.use(
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    const { container } = renderWithRoute([init])
    const input = await screen.findByRole('textbox', { name: /name/i })
    // dark border color rgb(55,65,81)
    expect(input.style.borderColor).toBe('rgb(55, 65, 81)')
    await userEvent.click(screen.getByRole('tab', { name: /advanced/i }))
    await userEvent.click(screen.getByRole('tab', { name: /health/i }))
    await userEvent.click(screen.getByRole('tab', { name: /general/i }))
    expect(container).toBeTruthy()
  })

  test('cancel navigates back to /plants', async () => {
    const init = { pathname: '/plants/u5/edit', state: { plant: { uuid: 'u5', name: 'X' } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })
})
