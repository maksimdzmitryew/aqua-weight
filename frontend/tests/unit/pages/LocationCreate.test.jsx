import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import LocationCreate from '../../../src/pages/LocationCreate.jsx'
import { locationsApi } from '../../../src/api/locations'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'

// Mock useNavigate to assert navigations while keeping other router utilities
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    __esModule: true,
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderPage({ initialEntries = ['/locations/new'] } = {}) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={<LocationCreate />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/LocationCreate', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    // reset theme
    try { localStorage.removeItem('theme') } catch {}
  })

  it('client-side validation: empty name shows error and a11y wiring; clears on change', async () => {
    const user = userEvent.setup()
    renderPage()

    const nameInput = screen.getByRole('textbox', { name: /name/i })
    // Type whitespace so native required passes, but trim() yields empty → component shows error
    await user.type(nameInput, '   ')
    await user.click(screen.getByRole('button', { name: /save/i }))

    const err = await screen.findByText(/name is required/i)
    expect(err).toBeInTheDocument()
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-describedby', 'name-error')

    // Type to clear error
    await user.type(nameInput, 'Living room')
    expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument()
  })

  // Note: Browser native required validation prevents submitting completely empty value under test env,
  // so we don't try to exercise untouched-empty submit path. Instead, we cover remaining branches below.

  it('client-side validation via programmatic submit: untouched empty name hits (loc.name || "") right-hand branch', async () => {
    const { container } = renderPage()
    const form = container.querySelector('form')
    // Bypass native required validation by dispatching submit event directly
    fireEvent.submit(form)
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()
  })

  it('successful save posts to API and navigates back to /locations', async () => {
    const user = userEvent.setup()
    // Success handler (201)
    server.use(
      http.post('/api/locations', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ name: 'Shelf', description: null })
        return HttpResponse.json({ uuid: 'loc-1', id: 1 }, { status: 201 })
      })
    )

    renderPage()

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'Shelf')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Navigates to list
    expect(mockNavigate).toHaveBeenCalledWith('/locations')
  })

  it('server error maps to name field error', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/locations', () => HttpResponse.json({ message: 'Already exists' }, { status: 409 }))
    )

    renderPage()

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'Office')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
  })

  it('server error without message shows generic fallback', async () => {
    const user = userEvent.setup()
    // Mock the API to reject with an object that has no message (or empty message)
    const spy = vi.spyOn(locationsApi, 'create').mockRejectedValueOnce({})

    renderPage()

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'Office 2')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()

    spy.mockRestore()
  })

  it('sends trimmed non-null description when provided', async () => {
    const user = userEvent.setup()
    // Intercept request to assert payload
    server.use(
      http.post('/api/locations', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ name: 'Desk', description: 'north wall' })
        return HttpResponse.json({ uuid: 'loc-2', id: 2 }, { status: 201 })
      })
    )

    renderPage()

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'Desk')
    await user.type(screen.getByRole('textbox', { name: /description/i }), '  north wall  ')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/locations')
  })

  it('cancel button navigates back to /locations without saving', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/locations')
  })

  it('renders under dark theme (style branches executed)', async () => {
    const user = userEvent.setup()
    try { localStorage.setItem('theme', 'dark') } catch {}

    const { container } = renderPage()
    const form = container.querySelector('form')
    expect(form).toBeInTheDocument()

    const nameInput = screen.getByRole('textbox', { name: /name/i })
    // Border color for dark theme branch
    expect(nameInput.style.borderColor).toBe('rgb(55, 65, 81)')

    // Interact to ensure no runtime errors
    await user.type(nameInput, 'Dark Themed Name')
  })
})
