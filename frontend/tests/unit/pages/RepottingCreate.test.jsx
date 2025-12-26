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
    try { localStorage.removeItem('theme') } catch {}
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'p1', name: 'Aloe' },
        { uuid: 'p2', name: 'Monstera' },
      ]))
    )
  })

  afterEach(() => {
    try { localStorage.removeItem('theme') } catch {}
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

    // Numeric fields are optional now; still fill them here to assert number conversion
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

  test('edit flow: allows blank numeric fields mapping to nulls in payload', async () => {
    const user = userEvent.setup()
    let putBody = null
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json({
        id: 77,
        plant_id: 'p1',
        measured_at: '2025-01-01T10:00',
        weight_before_repotting_g: 111,
        last_wet_weight_g: 222,
      })),
      http.put('/api/measurements/repotting/:id', async ({ request }) => {
        putBody = await request.json()
        return HttpResponse.json({ ok: true })
      })
    )

    renderWithRouter(['/repotting/edit?id=77'])

    // Clear both numeric inputs to hit null branches
    const weightBefore = await screen.findByLabelText(/weight before repotting/i)
    await user.clear(weightBefore)
    const lastWet = screen.getByLabelText(/weight after repotting/i)
    await user.clear(lastWet)

    await user.click(screen.getByRole('button', { name: /save repotting/i }))

    await waitFor(() => expect(putBody).not.toBeNull())
    expect(putBody).toEqual(expect.objectContaining({
      measured_weight_g: null,
      last_wet_weight_g: null,
    }))
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

  test('edit flow: shows error when existing repotting load fails', async () => {
    // Make the GET for existing measurement fail
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.text('nope', { status: 500 }))
    )

    renderWithRouter(['/repotting/edit?id=123'])

    // The component should render a user-friendly error
    expect(await screen.findByText(/failed to load repotting event/i)).toBeInTheDocument()
  })

  test('plants list: non-array response results in empty options (branch coverage)', async () => {
    // Respond with an object instead of an array
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ ok: true }))
    )

    renderWithRouter(['/repotting/new'])

    // Only the placeholder option should be present
    const plantSelect = await screen.findByLabelText(/plant/i)
    const options = await screen.findAllByRole('option')
    expect(plantSelect).toBeInTheDocument()
    // placeholder + no plants
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent(/select plant/i)
  })

  test('edit flow: request resolves after unmount -> cancelled branch is taken', async () => {
    // Delay the response so we can unmount before it resolves
    server.use(
      http.get('/api/measurements/:id', async () => {
        await new Promise(r => setTimeout(r, 30))
        return HttpResponse.json({
          id: 5,
          plant_id: 'p1',
          measured_at: '2025-01-01T10:00',
          weight_before_repotting_g: 1,
          last_wet_weight_g: 2,
        })
      })
    )

    const utils = renderWithRouter(['/repotting/edit?id=5'])
    // Immediately unmount; when the delayed response arrives, effect cleanup sets cancelled=true and early-returns
    utils.unmount()

    // Give time for the handler to resolve to ensure the code path runs
    await new Promise(r => setTimeout(r, 50))
  })

  test('edit flow: save error shows server message (update branch)', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json({
        id: 42,
        plant_id: 'p1',
        measured_at: '2025-01-01T10:00',
        weight_before_repotting_g: 10,
        last_wet_weight_g: 20,
      })),
      http.put('/api/measurements/repotting/:id', () => HttpResponse.text('bad', { status: 500 }))
    )

    renderWithRouter(['/repotting/edit?id=42'])

    const weightBefore = await screen.findByLabelText(/weight before repotting/i)
    await user.clear(weightBefore)
    await user.type(weightBefore, '11')
    const lastWet = screen.getByLabelText(/weight after repotting/i)
    await user.clear(lastWet)
    await user.type(lastWet, '22')

    await user.click(screen.getByRole('button', { name: /save repotting/i }))
    expect(await screen.findByText(/bad/i)).toBeInTheDocument()
  })

  test('edit flow: update error without message falls back to generic', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json({
        id: 44,
        plant_id: 'p1',
        measured_at: '2025-01-01T10:00',
        weight_before_repotting_g: 10,
        last_wet_weight_g: 20,
      }))
    )
    // Spy on the module's update to reject with object without message
    const mod = await vi.importActual('../../../src/api/measurements')
    const spy = vi.spyOn(mod.measurementsApi.repotting, 'update').mockRejectedValueOnce({})

    renderWithRouter(['/repotting/edit?id=44'])
    // Ensure submit is enabled and click it (no need to change values)
    await screen.findByLabelText(/plant/i)
    await user.click(screen.getByRole('button', { name: /save repotting/i }))

    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()
    spy.mockRestore()
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

  test('submit handler early-returns when canSave is false (branch)', async () => {
    // Render with defaults: plant is not selected, numeric fields empty
    renderWithRouter(['/repotting/new'])

    // Get the form via the submit button's closest form
    const submitBtn = await screen.findByRole('button', { name: /save repotting/i })
    const form = submitBtn.closest('form')
    expect(form).not.toBeNull()

    // Try submitting programmatically even though button is disabled
    // This should hit the `if (!canSave) return` branch and perform no navigation
    form && form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    // Give the event loop a tick
    await Promise.resolve()

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('create flow: allows blank numeric fields and posts nulls in payload (branch for ternaries)', async () => {
    const user = userEvent.setup()
    let captured = null
    server.use(
      http.post('/api/measurements/repotting', async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json({ id: 2 }, { status: 201 })
      })
    )

    renderWithRouter(['/repotting/new'])

    // Select plant, leave numbers blank
    const plantSelect = await screen.findByLabelText(/plant/i)
    await user.selectOptions(plantSelect, 'p1')

    const submit = screen.getByRole('button', { name: /save repotting/i })
    await waitFor(() => expect(submit).not.toBeDisabled())
    await user.click(submit)

    await waitFor(() => expect(captured).not.toBeNull())
    expect(captured).toEqual(expect.objectContaining({
      plant_id: 'p1',
      measured_weight_g: null,
      last_wet_weight_g: null,
    }))
  })

  test('create flow: error without message falls back to generic message (catch branch)', async () => {
    const user = userEvent.setup()
    // Mock the module function to throw an error-like object without a message
    const mod = await vi.importActual('../../../src/api/measurements')
    const spy = vi.spyOn(mod.measurementsApi.repotting, 'create').mockRejectedValueOnce({})

    renderWithRouter(['/repotting/new'])
    const plantSelect = await screen.findByLabelText(/plant/i)
    await user.selectOptions(plantSelect, 'p2')

    await user.click(screen.getByRole('button', { name: /save repotting/i }))
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()

    spy.mockRestore()
  })

  test('dark theme branch and measured_at onChange handler are covered', async () => {
    const user = userEvent.setup()
    try { localStorage.setItem('theme', 'dark') } catch {}

    let captured = null
    server.use(
      http.post('/api/measurements/repotting', async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json({ id: 3 }, { status: 201 })
      })
    )

    renderWithRouter(['/repotting/new'])

    // Select plant to enable submit
    const plantSelect = await screen.findByLabelText(/plant/i)
    await user.selectOptions(plantSelect, 'p1')

    // Change measured_at to ensure onChange branch executed
    const measuredAt = screen.getByLabelText(/measured at/i)
    await user.clear(measuredAt)
    await user.type(measuredAt, '2025-02-02T12:34')

    await user.click(screen.getByRole('button', { name: /save repotting/i }))

    await waitFor(() => expect(captured).not.toBeNull())
    expect(captured.measured_at).toBe('2025-02-02T12:34')
  })

  test('light theme branch renders (isDark=false)', async () => {
    try { localStorage.setItem('theme', 'light') } catch {}
    renderWithRouter(['/repotting/new'])
    // Wait for form elements to ensure render occurred under light theme
    expect(await screen.findByLabelText(/plant/i)).toBeInTheDocument()
  })
})
