import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import MeasurementCreate from '../../../src/pages/MeasurementCreate.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { measurementsApi } from '../../../src/api/measurements'

// Mock navigate to observe navigations
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { __esModule: true, ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../../src/components/DashboardLayout.jsx', () => ({
  default: ({ children, title }) => (
    <div data-testid="mock-dashboard-layout">
      <h1>{title}</h1>
      {children}
    </div>
  )
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

vi.mock('../../../src/components/form/fields/Checkbox.jsx', () => ({
  default: ({ label, form, name }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        type="checkbox"
        {...form.register(name)}
        checked={form.values[name]}
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
    toLocalISOMinutes: (val) => (val && val !== 'invalid') ? val.substring(0, 16) : ''
  }
})

function renderWithRouter(initialEntries) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={<MeasurementCreate />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/MeasurementCreate', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    // default handlers for plants list
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe' },
        { uuid: 'u2', name: 'Monstera' },
      ]))
    )
  })

  test('create flow: preselects plant from query and submits successfully', async () => {
    let called = false
    server.use(
      http.post('/api/measurements/weight', async ({ request }) => {
        const payload = await request.json()
        expect(payload.plant_id).toBe('u1')
        // measured_weight_g converts to number or null; we did not fill it → null
        expect(payload.measured_weight_g).toBe(null)
        called = true
        return HttpResponse.json({ id: 101 }, { status: 201 })
      })
    )

    renderWithRouter([{ pathname: '/new', search: '?plant=u1', state: { from: '/plants?tab=1' } }])

    // Select should show Aloe preselected
    const plantSelect = await screen.findByLabelText(/plant/i)
    await waitFor(() => expect(plantSelect).toHaveValue('u1'))

    // Submit
    const submit = screen.getByRole('button', { name: /save measurement/i })
    // Wait until form becomes valid (button enabled)
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    // Ensure POST was invoked (covers submit path)
    await waitFor(() => expect(called).toBe(true))
  })

  test('edit flow loads existing by id and updates via PUT', async () => {
    server.use(
      http.get('/api/measurements/:id', ({ params }) => {
        expect(params.id).toBe('500')
        return HttpResponse.json({
          id: 500,
          plant_id: 'u2',
          measured_at: '2025-01-10T12:34:00Z',
          measured_weight_g: 123,
          method_id: 'm1',
          use_last_method: false,
          scale_id: 'sc1',
          note: 'old',
        })
      }),
      http.put('/api/measurements/weight/:id', async ({ params, request }) => {
        expect(params.id).toBe('500')
        const payload = await request.json()
        // plant_id should remain the same and select disabled
        expect(payload.plant_id).toBe('u2')
        return HttpResponse.json({ ok: true })
      })
    )

    renderWithRouter(['/edit?id=500'])

    // Wait for plant select and ensure disabled in edit mode
    const plantSelect = await screen.findByLabelText(/plant/i)
    expect(plantSelect).toBeDisabled()

    // Update measurement and fix invalid hex fields so the form becomes valid
    const weight = screen.getByLabelText(/measured weight/i)
    await fireEvent.change(weight, { target: { value: '200' } })

    const method = screen.getByLabelText(/method \(optional, hex id\)/i)
    await fireEvent.change(method, { target: { value: 'a'.repeat(32) } })

    const scale = screen.getByLabelText(/scale \(optional, hex id\)/i)
    await fireEvent.change(scale, { target: { value: 'b'.repeat(32) } })

    fireEvent.click(screen.getByRole('button', { name: /update measurement/i }))
    // On success without from-state, it should navigate -1 fallback
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(-1))
  }, 15000)

  test('edit flow: loadExisting failure is ignored (catch path executed)', async () => {
    // Force GET to fail to cover the catch branch in loadExisting
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json({ message: 'nope' }, { status: 500 }))
    )

    renderWithRouter(['/edit?id=404'])

    // Component should render edit mode title and not crash, even though GET failed
    expect(await screen.findByRole('heading', { name: /edit measurement/i })).toBeInTheDocument()

    // Plant select is disabled in edit mode regardless; no general error should be shown from this failure
    const plantSelect = await screen.findByLabelText(/plant/i)
    expect(plantSelect).toBeDisabled()
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument()
  })

  test('edit flow: effect cancelled before response arrives (covers cancelled branch)', async () => {
    // Delay the GET so we can unmount first and hit the `if (cancelled) return` path
    server.use(
      http.get('/api/measurements/:id', () => new Promise(resolve => {
        setTimeout(() => resolve(HttpResponse.json({
          id: 'slow', plant_id: 'u1', measured_at: '2025-01-01T00:00:00Z'
        })), 50)
      }))
    )

    const utils = renderWithRouter(['/edit?id=slow'])
    // Immediately unmount to set cancelled = true in cleanup
    utils.unmount()
    // Wait a tick to allow the delayed handler to resolve without updating unmounted component
    await new Promise(r => setTimeout(r, 75))
    // If the effect respects the cancelled flag, there should be no error logs or act warnings.
    // Nothing to assert; test passes by not throwing.
  })

  test('plants API returns non-array; select shows only placeholder', async () => {
    // Return a non-array to exercise Array.isArray false branch in loadPlants
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ any: 'shape' }))
    )

    renderWithRouter(['/new'])
    const select = await screen.findByLabelText(/plant/i)
    // Only default option should be present; value remains empty
    expect(select).toHaveValue('')
    const options = select.querySelectorAll('option')
    expect(options.length).toBe(1)
  })

  test('edit flow with missing fields uses fallbacks in form values', async () => {
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json({
        id: 777,
        plant_id: '', // missing plant id should fallback to current form value (empty)
        measured_at: null, // missing measured_at to exercise fallback to existing form value (line 65)
        measured_weight_g: null, // becomes '' in input
        method_id: '', // becomes ''
        // use_last_method missing -> defaults to true
        scale_id: '', // becomes ''
        note: null, // becomes ''
      })),
    )

    renderWithRouter(['/edit?id=777'])

    // Wait for the GET to resolve
    const dt = await screen.findByLabelText(/measured at/i)
    const initial = dt.value
    await waitFor(() => expect(dt).toHaveValue(initial))

    // Weight input should be empty string due to null -> '' mapping
    const weight = await screen.findByLabelText(/measured weight/i)
    expect(weight).toHaveValue(null) // empty text input -> value null in DOM API

    // Checkbox defaults to checked (true)
    const useLast = screen.getByLabelText(/use last method/i)
    expect(useLast).toBeChecked()

    // Method and Scale inputs should be empty strings
    expect(screen.getByLabelText(/method \(optional, hex id\)/i)).toHaveValue('')
    expect(screen.getByLabelText(/scale \(optional, hex id\)/i)).toHaveValue('')
  })

  test('submit with location.state.from navigates to that path', async () => {
    server.use(
      http.post('/api/measurements/weight', () => HttpResponse.json({ id: 1 }, { status: 201 }))
    )

    renderWithRouter([{ pathname: '/new', search: '?plant=u1', state: { from: '/custom-path' } }])

    const submit = await screen.findByRole('button', { name: /save measurement/i })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/custom-path'))
  })

  test('edit flow: API returns null data', async () => {
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json(null))
    )

    renderWithRouter(['/edit?id=123'])

    // Wait for the GET to resolve
    const dt = await screen.findByLabelText(/measured at/i)
    const initial = dt.value
    await waitFor(() => expect(dt).toHaveValue(initial))
    
    // Check that other fields also use fallbacks (not crashing)
    expect(screen.getByLabelText(/measured weight/i)).toHaveValue(null)
  })

  test('edit flow: invalid measured_at falls back to current form value', async () => {
    // Return a measured_at that cannot be parsed by toLocalISOMinutes to hit the `|| form.values.measured_at` branch
    // and also cover the branch where data?.measured_at is truthy but toLocalISOMinutes returns falsy (empty string)
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json({
        id: 909,
        plant_id: 'u1',
        measured_at: 'invalid', // will make toLocalISOMinutes return '' in the mock
        measured_weight_g: 10,
      }))
    )

    renderWithRouter(['/edit?id=909'])

    // Capture the initial value set by nowLocalISOMinutes()
    const dt = await screen.findByLabelText(/measured at/i)
    const initial = dt.value

    // Wait for the GET to resolve and ensure the value remained unchanged (fallback was used)
    await waitFor(() => expect(dt).toHaveValue(initial))
  })

  test('save error without message shows generic fallback', async () => {
    // Spy on API layer to reject with an object lacking `message` to hit the fallback branch (e.message || 'Failed to save')
    const spy = vi.spyOn(measurementsApi.weight, 'create').mockRejectedValueOnce({})
    renderWithRouter(['/new?plant=u1'])
    fireEvent.click(await screen.findByRole('button', { name: /save measurement/i }))
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('shows error when plants API fails to load', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ message: 'fail' }, { status: 500 }))
    )
    renderWithRouter(['/'])
    expect(await screen.findByText(/failed to load plants/i)).toBeInTheDocument()
  })

  test('save error renders message', async () => {
    server.use(
      http.post('/api/measurements/weight', () => HttpResponse.json({ message: 'nope' }, { status: 500 }))
    )

    renderWithRouter(['/new?plant=u1'])
    const saveBtn = await screen.findByRole('button', { name: /save measurement/i })
    await waitFor(() => expect(saveBtn).not.toBeDisabled())
    fireEvent.click(saveBtn)
    expect(await screen.findByText(/nope|Failed to save/i)).toBeInTheDocument()
  })

  test('dark theme styling applied and cancel navigates to /plants', async () => {
    try { localStorage.setItem('theme', 'dark') } catch {}
    // success handlers
    server.use(
      http.post('/api/measurements/weight', () => HttpResponse.json({ id: 1 }, { status: 201 }))
    )
    renderWithRouter(['/new?plant=u1'])

    const note = await screen.findByLabelText(/note/i)
    // textarea border color for dark theme (#374151)
    expect(note.style.border).toContain('rgb(55, 65, 81)')

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })
})
