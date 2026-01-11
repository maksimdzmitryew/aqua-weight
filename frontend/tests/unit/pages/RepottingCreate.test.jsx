import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

vi.mock('../../../src/components/DashboardLayout.jsx', () => ({
  default: ({ children }) => <div data-testid="mock-dashboard-layout">{children}</div>
}))

vi.mock('../../../src/components/feedback/Loader.jsx', () => ({
  default: ({ message }) => <div role="status" data-testid="loader">{message || 'Loading...'}</div>
}))

vi.mock('../../../src/components/feedback/ErrorNotice.jsx', () => ({
  default: ({ message }) => <div role="alert" data-testid="error-notice">{message}</div>
}))

vi.mock('../../../src/components/PageHeader.jsx', () => ({
  default: ({ onBack, title }) => (
    <div data-testid="mock-page-header">
      <h1>{title}</h1>
      <button onClick={onBack}>Back</button>
    </div>
  )
}))

vi.mock('../../../src/components/form/fields/DateTimeLocal.jsx', () => ({
  default: ({ label, form, name, required }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="datetime-local"
        {...form.register(name)}
        required={required}
      />
    </div>
  )
}))

vi.mock('../../../src/components/form/fields/Select.jsx', () => ({
  default: ({ label, form, name, children, required, disabled }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <select
        id={name}
        {...form.register(name)}
        required={required}
        disabled={disabled}
      >
        {children}
      </select>
    </div>
  )
}))

vi.mock('../../../src/components/form/fields/NumberInput.jsx', () => ({
  default: ({ label, form, name, min }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="number"
        min={min}
        {...form.register(name)}
      />
    </div>
  )
}))

vi.mock('../../../src/components/form/fields/TextInput.jsx', () => ({
  default: ({ label, form, name, placeholder }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="text"
        placeholder={placeholder}
        {...form.register(name)}
      />
    </div>
  )
}))

vi.mock('../../../src/utils/datetime.js', async () => {
  const actual = await vi.importActual('../../../src/utils/datetime.js')
  return {
    ...actual,
    nowLocalISOMinutes: () => '2025-01-10T23:00',
    toLocalISOMinutes: (val) => val ? val.substring(0, 16) : ''
  }
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
    fireEvent.change(weightBefore, { target: { value: '200' } })

    const lastWet = screen.getByLabelText(/weight after repotting/i)
    fireEvent.change(lastWet, { target: { value: '350' } })

    const submit = screen.getByRole('button', { name: /save repotting/i })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/plants/p2'))
    expect(captured).toEqual(expect.objectContaining({
      plant_id: 'p2',
      measured_weight_g: 200,
      last_wet_weight_g: 350,
    }))
  })

  test('edit flow: loads existing by id, updates via PUT and navigates', async () => {
    
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
    fireEvent.change(weightBefore, { target: { value: '123' } })

    const lastWet = screen.getByLabelText(/weight after repotting/i)
    fireEvent.change(lastWet, { target: { value: '456' } })

    fireEvent.click(screen.getByRole('button', { name: /save repotting/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/plants/p1'))
  })

  test('edit flow: allows blank numeric fields mapping to nulls in payload', async () => {
    
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
    fireEvent.change(weightBefore, { target: { value: '' } })
    const lastWet = screen.getByLabelText(/weight after repotting/i)
    fireEvent.change(lastWet, { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: /save repotting/i }))

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
    fireEvent.change(weightBefore, { target: { value: '' } })
    fireEvent.change(weightBefore, { target: { value: '11' } })
    const lastWet = screen.getByLabelText(/weight after repotting/i)
    fireEvent.change(lastWet, { target: { value: '' } })
    fireEvent.change(lastWet, { target: { value: '22' } })

    fireEvent.click(screen.getByRole('button', { name: /save repotting/i }))
    expect(await screen.findByText(/bad/i)).toBeInTheDocument()
  })

  test('edit flow: update error without message falls back to generic', async () => {
    
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
    fireEvent.click(screen.getByRole('button', { name: /save repotting/i }))

    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('save error shows generic message', async () => {
    
    // Plants load succeeds (default handler), but save fails
    server.use(
      http.post('/api/measurements/repotting', () => HttpResponse.text('boom', { status: 500 }))
    )

    renderWithRouter(['/repotting/new'])

    const plantSelect = await screen.findByLabelText(/plant/i)
    // Wait until the options are populated (beyond the placeholder)
    await screen.findByRole('option', { name: /aloe/i })
    fireEvent.change(plantSelect, { target: { value: 'p1' } })
    const weightBefore = screen.getByLabelText(/weight before repotting/i)
    fireEvent.change(weightBefore, { target: { value: '' } })
    fireEvent.change(weightBefore, { target: { value: '1' } })
    const lastWet = screen.getByLabelText(/weight after repotting/i)
    fireEvent.change(lastWet, { target: { value: '' } })
    fireEvent.change(lastWet, { target: { value: '2' } })

    fireEvent.click(screen.getByRole('button', { name: /save repotting/i }))
    // ApiError message is derived from response text 'boom'
    expect(await screen.findByText(/boom/i)).toBeInTheDocument()
  })

  test('cancel navigates back to /plants and button disabled when form incomplete', async () => {
    
    renderWithRouter(['/repotting/new'])

    const submit = await screen.findByRole('button', { name: /save repotting/i })
    expect(submit).toBeDisabled()

    const cancel = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancel)
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
    fireEvent.change(plantSelect, { target: { value: 'p1' } })

    const submit = screen.getByRole('button', { name: /save repotting/i })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)

    await waitFor(() => expect(captured).not.toBeNull())
    expect(captured).toEqual(expect.objectContaining({
      plant_id: 'p1',
      measured_weight_g: null,
      last_wet_weight_g: null,
    }))
  })

  test('create flow: error without message falls back to generic message (catch branch)', async () => {
    
    // Mock the module function to throw an error-like object without a message
    const mod = await vi.importActual('../../../src/api/measurements')
    const spy = vi.spyOn(mod.measurementsApi.repotting, 'create').mockRejectedValueOnce({})

    renderWithRouter(['/repotting/new'])
    const plantSelect = await screen.findByLabelText(/plant/i)
    fireEvent.change(plantSelect, { target: { value: 'p2' } })

    fireEvent.click(screen.getByRole('button', { name: /save repotting/i }))
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()

    spy.mockRestore()
  })

  test('dark theme branch and measured_at onChange handler are covered', async () => {
    
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
    fireEvent.change(plantSelect, { target: { value: 'p1' } })

    // Change measured_at to ensure onChange branch executed
    const measuredAt = screen.getByLabelText(/measured at/i)
    fireEvent.change(measuredAt, { target: { value: '' } })
    fireEvent.change(measuredAt, { target: { value: '2025-02-02T12:34' } })

    fireEvent.click(screen.getByRole('button', { name: /save repotting/i }))

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
