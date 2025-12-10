import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import RepottingCreate from '../../../src/pages/RepottingCreate.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

// Mock navigate to observe navigations
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { __esModule: true, ...actual, useNavigate: () => mockNavigate }
})

function renderWithRouter(initialEntries) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={<RepottingCreate />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/RepottingCreate', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'p1', name: 'Aloe' },
        { uuid: 'p2', name: 'Monstera' },
      ]))
    )
  })

  test('create flow: preselects plant from query, submits and navigates to plant page', async () => {
    const user = userEvent.setup()
    let captured = null
    server.use(
      http.post('/api/measurements/repotting', async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json({ id: 1 }, { status: 201 })
      })
    )

    renderWithRouter([{ pathname: '/repotting/new', search: '?plant=p2' }])

    const plantSelect = await screen.findByLabelText(/plant/i)
    await waitFor(() => expect(plantSelect).toHaveValue('p2'))

    // Fill required numeric fields
    const weightBefore = screen.getByLabelText(/weight before repotting/i)
    await user.clear(weightBefore)
    await user.type(weightBefore, '200')

    const lastWet = screen.getByLabelText(/weight after repotting/i)
    await user.clear(lastWet)
    await user.type(lastWet, '350')

    const submit = screen.getByRole('button', { name: /save repotting/i })
    await waitFor(() => expect(submit).not.toBeDisabled())
    await user.click(submit)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/plants/p2'))
    expect(captured).toEqual(expect.objectContaining({
      plant_id: 'p2',
      measured_weight_g: 200,
      last_wet_weight_g: 350,
    }))
  })

  test('edit flow: loads existing by id, updates via PUT and navigates', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/measurements/:id', ({ params }) => {
        expect(params.id).toBe('77')
        return HttpResponse.json({
          id: 77,
          plant_id: 'p1',
          measured_at: '2025-01-01T10:00',
          weight_before_repotting_g: 111,
          last_wet_weight_g: 222,
        })
      }),
      http.put('/api/measurements/repotting/:id', async ({ params, request }) => {
        expect(params.id).toBe('77')
        const body = await request.json()
        expect(body).toEqual(expect.objectContaining({
          plant_id: 'p1',
          measured_at: '2025-01-01T10:00',
          measured_weight_g: 123,
          last_wet_weight_g: 456,
        }))
        return HttpResponse.json({ ok: true })
      })
    )

    renderWithRouter(['/repotting/edit?id=77'])

    const weightBefore = await screen.findByLabelText(/weight before repotting/i)
    await user.clear(weightBefore)
    await user.type(weightBefore, '123')

    const lastWet = screen.getByLabelText(/weight after repotting/i)
    await user.clear(lastWet)
    await user.type(lastWet, '456')

    await user.click(screen.getByRole('button', { name: /save repotting/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/plants/p1'))
  })

  test('shows error when plants load fails', async () => {
    // Fail plants load
    server.use(
      http.get('/api/plants', () => HttpResponse.text('no', { status: 500 }))
    )

    renderWithRouter(['/repotting/new'])

    // Plants load error rendered
    expect(await screen.findByText(/failed to load plants/i)).toBeInTheDocument()
  })

  test('save error shows generic message', async () => {
    const user = userEvent.setup()
    // Plants load succeeds (default handler), but save fails
    server.use(
      http.post('/api/measurements/repotting', () => HttpResponse.text('boom', { status: 500 }))
    )

    renderWithRouter(['/repotting/new'])

    const plantSelect = await screen.findByLabelText(/plant/i)
    // Wait until the options are populated (beyond the placeholder)
    await screen.findByRole('option', { name: /aloe/i })
    await user.selectOptions(plantSelect, 'p1')
    const weightBefore = screen.getByLabelText(/weight before repotting/i)
    await user.clear(weightBefore)
    await user.type(weightBefore, '1')
    const lastWet = screen.getByLabelText(/weight after repotting/i)
    await user.clear(lastWet)
    await user.type(lastWet, '2')

    await user.click(screen.getByRole('button', { name: /save repotting/i }))
    // ApiError message is derived from response text 'boom'
    expect(await screen.findByText(/boom/i)).toBeInTheDocument()
  })

  test('cancel navigates back to /plants and button disabled when form incomplete', async () => {
    const user = userEvent.setup()
    renderWithRouter(['/repotting/new'])

    const submit = await screen.findByRole('button', { name: /save repotting/i })
    expect(submit).toBeDisabled()

    const cancel = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancel)
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })
})
