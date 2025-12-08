import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import LocationEdit from '../../../src/pages/LocationEdit.jsx'
import { vi } from 'vitest'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'

// Mock useNavigate to assert navigations while keeping router utilities
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    __esModule: true,
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderWithRoute(path, element, { initialEntries = [path] } = {}) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/LocationEdit', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    try { localStorage.removeItem('theme') } catch {}
  })

  test('prefills from location state, trims name, saves and navigates with updated state', async () => {
    const user = userEvent.setup()
    // Successful update
    server.use(
      http.put('/api/locations/by-name', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ original_name: 'Hall', name: 'New Name' })
        return HttpResponse.json({ ok: true })
      })
    )

    const init = {
      pathname: '/locations/2/edit',
      state: { location: { id: 2, name: 'Hall', type: 'zone', created_at: '2025-01-01T00:00:00' } },
    }
    renderWithRoute('/locations/:id/edit', <LocationEdit />, { initialEntries: [init] })

    const name = await screen.findByRole('textbox', { name: /name/i })
    // Add spaces to exercise trim
    await user.clear(name)
    await user.type(name, '  New Name  ')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/locations', expect.objectContaining({
      state: expect.objectContaining({ updatedLocation: expect.objectContaining({ id: 2, name: 'New Name' }) })
    }))
  })

  test('client-side validation: trimmed empty name shows field error and a11y attributes', async () => {
    const user = userEvent.setup()
    const init = {
      pathname: '/locations/3/edit',
      state: { location: { id: 3, name: 'Office', created_at: '2025-01-02T00:00:00' } },
    }
    renderWithRoute('/locations/:id/edit', <LocationEdit />, { initialEntries: [init] })

    const name = await screen.findByRole('textbox', { name: /name/i })
    await user.clear(name)
    await user.type(name, '   ')
    await user.click(screen.getByRole('button', { name: /save/i }))
    const err = await screen.findByText(/name cannot be empty/i)
    expect(err).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAttribute('aria-describedby', 'name-error')
  })

  test('loads location via API when no state provided; shows form afterwards', async () => {
    server.use(
      http.get('/api/locations', () => HttpResponse.json([
        { id: 5, name: 'Kitchen', type: 'room', created_at: '2025-01-03T00:00:00' },
        { id: 6, name: 'Balcony', created_at: '2025-01-04T00:00:00' },
      ]))
    )

    renderWithRoute('/locations/:id/edit', <LocationEdit />, { initialEntries: ['/locations/5/edit'] })

    // Loading first
    expect(screen.getByText(/loading/i)).toBeInTheDocument()

    // Then form appears with ID and name
    expect(await screen.findByDisplayValue('Kitchen')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  test('shows error when location is not found in list', async () => {
    server.use(
      http.get('/api/locations', () => HttpResponse.json([{ id: 7, name: 'Other' }]))
    )

    renderWithRoute('/locations/:id/edit', <LocationEdit />, { initialEntries: ['/locations/10/edit'] })

    expect(await screen.findByText(/location not found/i)).toBeInTheDocument()
  })

  test('maps 409/400 update error to name field error; other errors go to general error', async () => {
    const user = userEvent.setup()
    // First: 409 conflict → field error
    server.use(
      http.put('/api/locations/by-name', () => HttpResponse.json({ message: 'Already exists' }, { status: 409 }))
    )
    const init = {
      pathname: '/locations/8/edit',
      state: { location: { id: 8, name: 'Shelf' } },
    }
    renderWithRoute('/locations/:id/edit', <LocationEdit />, { initialEntries: [init] })

    const name = await screen.findByRole('textbox', { name: /name/i })
    await user.clear(name)
    await user.type(name, 'New')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    // No general error
    expect(screen.queryByText(/failed to save/i)).not.toBeInTheDocument()

    // Now: 500 → general error
    server.use(
      http.put('/api/locations/by-name', () => HttpResponse.json({ message: 'Boom' }, { status: 500 }))
    )
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/boom/i)).toBeInTheDocument()
  })

  test('cancel navigates back to /locations without saving', async () => {
    const user = userEvent.setup()
    const init = {
      pathname: '/locations/9/edit',
      state: { location: { id: 9, name: 'Porch' } },
    }
    renderWithRoute('/locations/:id/edit', <LocationEdit />, { initialEntries: [init] })
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/locations')
  })

  test('outer catch path: unexpected error after successful update sets general error (e.g., navigate throws)', async () => {
    const user = userEvent.setup()
    // Successful update
    server.use(
      http.put('/api/locations/by-name', () => HttpResponse.json({ ok: true }))
    )
    // Make navigate throw to trigger outer catch
    mockNavigate.mockImplementation(() => { throw new Error('nav fail') })

    const init = {
      pathname: '/locations/12/edit',
      state: { location: { id: 12, name: 'Start' } },
    }
    renderWithRoute('/locations/:id/edit', <LocationEdit />, { initialEntries: [init] })

    const name = await screen.findByRole('textbox', { name: /name/i })
    await user.clear(name)
    await user.type(name, 'Ok')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // General error message should contain thrown message
    expect(await screen.findByText(/nav fail/i)).toBeInTheDocument()
  })

  test('renders under dark theme and applies dark border color', async () => {
    const user = userEvent.setup()
    try { localStorage.setItem('theme', 'dark') } catch {}
    const init = {
      pathname: '/locations/11/edit',
      state: { location: { id: 11, name: 'Dark Place' } },
    }
    renderWithRoute('/locations/:id/edit', <LocationEdit />, { initialEntries: [init] })
    const input = await screen.findByRole('textbox', { name: /name/i })
    expect(input.style.borderColor).toBe('rgb(55, 65, 81)')
    await user.type(input, ' X')
  })
})
