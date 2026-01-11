import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
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
    renderPage()

    const nameInput = screen.getByRole('textbox', { name: /name/i })
    // Type whitespace so native required passes, but trim() yields empty → component shows error
    fireEvent.change(nameInput, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    const err = await screen.findByText(/name is required/i)
    expect(err).toBeInTheDocument()
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-describedby', 'name-error')

    // Type to clear error
    fireEvent.change(nameInput, { target: { value: 'Living room' } })
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
    // Success handler (201)
    server.use(
      http.post('/api/locations', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ name: 'Shelf', description: null })
        return HttpResponse.json({ uuid: 'loc-1', id: 1 }, { status: 201 })
      })
    )

    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /name/i }), { target: { value: 'Shelf' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    // Navigates to list
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/locations')
    })
  })

  it('server error maps to name field error', async () => {
    server.use(
      http.post('/api/locations', () => HttpResponse.json({ message: 'Already exists' }, { status: 409 }))
    )

    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /name/i }), { target: { value: 'Office' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
  })

  it('server error without message shows generic fallback', async () => {
    // Mock the API to reject with an object that has no message (or empty message)
    const spy = vi.spyOn(locationsApi, 'create').mockRejectedValueOnce({})

    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /name/i }), { target: { value: 'Office 2' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()

    spy.mockRestore()
  })

  it('sends trimmed non-null description when provided', async () => {
    // Intercept request to assert payload
    server.use(
      http.post('/api/locations', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ name: 'Desk', description: 'north wall' })
        return HttpResponse.json({ uuid: 'loc-2', id: 2 }, { status: 201 })
      })
    )

    renderPage()

    fireEvent.change(screen.getByRole('textbox', { name: /name/i }), { target: { value: 'Desk' } })
    fireEvent.change(screen.getByRole('textbox', { name: /description/i }), { target: { value: '  north wall  ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/locations')
    })
  })

  it('cancel button navigates back to /locations without saving', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/locations')
  })

  it('renders under dark theme (style branches executed)', async () => {
    try { localStorage.setItem('theme', 'dark') } catch {}

    const { container } = renderPage()
    const form = container.querySelector('form')
    expect(form).toBeInTheDocument()

    const nameInput = screen.getByRole('textbox', { name: /name/i })
    // Border color for dark theme branch
    expect(nameInput.style.borderColor).toBe('rgb(55, 65, 81)')

    // Interact to ensure no runtime errors
    fireEvent.change(nameInput, { target: { value: 'Dark Themed Name' } })
  })
})
