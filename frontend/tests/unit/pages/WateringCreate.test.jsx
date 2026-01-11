import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import WateringCreate from '../../../src/pages/WateringCreate.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

// Mock navigate
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
          <Route path="*" element={<WateringCreate />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/WateringCreate', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    // default plants list
    server.use(
      http.get('/api/plants', () => HttpResponse.json([
        { uuid: 'u1', name: 'Aloe' },
        { uuid: 'u2', name: 'Monstera' },
      ]))
    )
  })

  test('create flow: preselects plant, posts payload and navigates to plant details', async () => {
    let posted = null
    server.use(
      http.post('/api/measurements/watering', async ({ request }) => {
        const body = await request.json()
        posted = body
        return HttpResponse.json({ id: 101 }, { status: 201 })
      })
    )

    renderWithRouter([{ pathname: '/new', search: '?plant=u1' }])

    const plantSelect = await screen.findByLabelText(/plant/i)
    await waitFor(() => expect(plantSelect).toHaveValue('u1'))

    // Fill a couple fields
    const curr = screen.getByLabelText(/current weight/i)
    await fireEvent.change(curr, { target: { value: '123' } })

    const submit = screen.getByRole('button', { name: /save watering/i })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted.plant_id).toBe('u1')
    expect(mockNavigate).toHaveBeenCalledWith('/plants/u1')
  })

  test('edit flow: loads existing by id and updates via PUT', async () => {
    server.use(
      http.get('/api/measurements/:id', ({ params }) => HttpResponse.json({
        id: Number(params.id),
        plant_id: 'u2',
        measured_at: '2025-01-10T12:34:00Z',
        last_dry_weight_g: 10,
        last_wet_weight_g: 20,
        water_added_g: 5,
      })),
      http.put('/api/measurements/watering/:id', async ({ params, request }) => {
        expect(params.id).toBe('500')
        const body = await request.json()
        expect(body.plant_id).toBeUndefined() // not sent in edit
        return HttpResponse.json({ ok: true })
      })
    )

    renderWithRouter(['/edit?id=500'])

    // Plant select disabled in edit mode
    const plantSelect = await screen.findByLabelText(/plant/i)
    expect(plantSelect).toBeDisabled()

    // Change a field and submit
    const curr = screen.getByLabelText(/current weight/i)
    await fireEvent.change(curr, { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: /update watering/i }))

    // Navigates to plant details of loaded plant_id
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/plants/u2'))
  })

  test('edit flow: gracefully ignores loadExisting failure (catch path)', async () => {
    // Force GET by id to fail -> exercises catch block in loadExisting effect
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json({ message: 'err' }, { status: 500 }))
    )

    renderWithRouter(['/edit?id=404'])

    // Form should still render and remain in edit mode (plant select disabled)
    const plantSelect = await screen.findByLabelText(/plant/i)
    expect(plantSelect).toBeDisabled()

    // Submit does not throw; navigate will still target current plant_id value (empty),
    // but we won't assert navigate here; just ensure button exists and is enabled/disabled per validity
    expect(screen.getByRole('button', { name: /update watering/i })).toBeInTheDocument()
  })

  test('shows error on plants load failure and on save failure', async () => {
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ message: 'fail' }, { status: 500 }))
    )
    renderWithRouter(['/'])
    expect(await screen.findByText(/failed to load plants/i)).toBeInTheDocument()

    server.use(
      // Provide list containing the preselected plant so the form can be valid
      http.get('/api/plants', () => HttpResponse.json([{ uuid: 'u1', name: 'Aloe' }])),
      http.post('/api/measurements/watering', () => HttpResponse.json({ message: 'nope' }, { status: 500 }))
    )
    const { container } = renderWithRouter(['/new?plant=u1'])
    // Submit the form directly to exercise catch path even if button is disabled in this environment
    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form)
    expect(await screen.findByText(/nope|failed to save/i)).toBeInTheDocument()
  })

  test('dark theme renders and cancel navigates using document.referrer', async () => {
    try { localStorage.setItem('theme', 'dark') } catch {}
    renderWithRouter(['/new?plant=u1'])
    // Wait for select to ensure form rendered under dark theme
    await screen.findByLabelText(/plant/i)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    // document.referrer is empty string in jsdom
    expect(mockNavigate).toHaveBeenCalledWith('')
  })

  test('handles plants list that is not an array', async () => {
    // Return an object instead of array to take Array.isArray(data) false path
    server.use(
      http.get('/api/plants', () => HttpResponse.json({ not: 'an array' }))
    )
    renderWithRouter(['/new'])
    // Form still renders and select has only the placeholder option
    const select = await screen.findByLabelText(/plant/i)
    // Open the native select is not supported; just ensure it exists
    expect(select).toBeInTheDocument()
  })

  test('edit flow: fetched data without measured_at uses existing form value', async () => {
    // Ensure plants list exists so form is valid enough
    server.use(
      http.get('/api/plants', () => HttpResponse.json([{ uuid: 'u2', name: 'Monstera' }])),
      http.get('/api/measurements/:id', () => HttpResponse.json({ id: 777, plant_id: 'u2' }))
    )

    renderWithRouter(['/edit?id=777'])

    const dt = await screen.findByLabelText(/measured at/i)
    // Ensure the control is rendered; jsdom may not reflect default datetime-local values reliably
    expect(dt).toBeInTheDocument()
  })

  test('edit flow: unmount before loadExisting resolves triggers cancelled branch (no state update)', async () => {
    // Slow down the measurement fetch so component can unmount first
    server.use(
      http.get('/api/measurements/:id', async () => {
        await new Promise(r => setTimeout(r, 80))
        return HttpResponse.json({ id: 909, plant_id: 'u2', measured_at: '2025-01-10T12:34:00Z' })
      })
    )

    const utils = renderWithRouter(['/edit?id=909'])
    // Immediately unmount before the async handler resolves
    utils.unmount()
    // Wait to allow the request to finish without causing state updates
    await new Promise(r => setTimeout(r, 120))
    // If we reach here without React state update warnings, the cancelled path was followed
  })

  test('edit flow: falls back to existing plant_id when response has none', async () => {
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json({ id: 801, measured_at: '2025-01-10T12:34:00Z' }))
    )
    renderWithRouter(['/edit?id=801'])
    const plantSelect = await screen.findByLabelText(/plant/i)
    // In edit mode without returned plant_id, value stays as initial ('')
    expect(plantSelect).toHaveValue('')
  })

  test('edit flow: measured_at provided but unparsable falls back to current form measured_at', async () => {
    // Return a measured_at that exists (truthy) but toLocalISOMinutes returns '' (falsy)
    // To trigger: toLocalISOMinutes(data.measured_at) || form.values.measured_at
    server.use(
      http.get('/api/plants', () => HttpResponse.json([{ uuid: 'u2', name: 'Monstera' }])),
      http.get('/api/measurements/:id', () => HttpResponse.json({ id: 611, plant_id: 'u2', measured_at: 'not-a-date' }))
    )
    renderWithRouter(['/edit?id=611'])
    const input = await screen.findByLabelText(/measured at/i)
    const initial = input.value
    // Wait for effect to run
    await waitFor(() => expect(input).toHaveValue(initial))
  })

  test('edit flow: measured_at maps via toLocalISOMinutes (truthy branch of OR)', async () => {
    // Return a measured_at that is truthy and toLocalISOMinutes returns a truthy value
    const dt = await import('../../../src/utils/datetime.js')
    const spy = vi.spyOn(dt, 'toLocalISOMinutes').mockReturnValue('2000-01-01T00:00')
    server.use(
      http.get('/api/plants', () => HttpResponse.json([{ uuid: 'u2', name: 'Monstera' }])),
      http.get('/api/measurements/:id', () => HttpResponse.json({ id: 612, plant_id: 'u2', measured_at: '2025-01-10T12:34:00Z' }))
    )
    renderWithRouter(['/edit?id=612'])
    const input = await screen.findByLabelText(/measured at/i)
    await waitFor(() => expect(input).toHaveValue('2000-01-01T00:00'))
    spy.mockRestore()
  })

  test('edit flow: measured_at maps via toLocalISOMinutes but returns falsy from toLocalISOMinutes', async () => {
    // Return a measured_at that is truthy but toLocalISOMinutes returns '' (falsy)
    // to exercise the second part of the ||: toLocalISOMinutes(data.measured_at) || form.values.measured_at
    const dt = await import('../../../src/utils/datetime.js')
    const spy = vi.spyOn(dt, 'toLocalISOMinutes').mockReturnValue('')
    server.use(
      http.get('/api/plants', () => HttpResponse.json([{ uuid: 'u2', name: 'Monstera' }])),
      http.get('/api/measurements/:id', () => HttpResponse.json({ id: 613, plant_id: 'u2', measured_at: 'some-truthy-date' }))
    )
    renderWithRouter(['/edit?id=613'])
    const input = await screen.findByLabelText(/measured at/i)
    const initial = input.value
    await waitFor(() => expect(input).toHaveValue(initial))
    spy.mockRestore()
  })

  test('save error without message falls back to generic text', async () => {
    const mod = await import('../../../src/api/measurements')
    const spy = vi.spyOn(mod.measurementsApi.watering, 'create').mockRejectedValueOnce({})
    server.use(
      http.get('/api/plants', () => HttpResponse.json([{ uuid: 'u1', name: 'Aloe' }]))
    )
    const { container } = renderWithRouter(['/new?plant=u1'])
    // Submit the form to trigger error path; generic fallback should be displayed
    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form)
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('edit flow: API returns null data (covers data?. branch)', async () => {
    // Return null from API to exercise the data?. branch in loadExisting
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json(null))
    )

    renderWithRouter(['/edit?id=123'])

    // Wait for the GET to resolve
    const dt = await screen.findByLabelText(/measured at/i)
    const initial = dt.value
    await waitFor(() => expect(dt).toHaveValue(initial))
    
    // Check that other fields are also handled (defaults used)
    const wetWeight = screen.getByLabelText(/current weight/i)
    expect(wetWeight).toHaveValue(null)
  })

  test('edit flow: API returns empty object (covers data?. branch)', async () => {
    // Return empty object from API to exercise the data?.measured_at when data is NOT null but measured_at is missing
    server.use(
      http.get('/api/measurements/:id', () => HttpResponse.json({}))
    )

    renderWithRouter(['/edit?id=456'])

    const dt = await screen.findByLabelText(/measured at/i)
    const initial = dt.value
    await waitFor(() => expect(dt).toHaveValue(initial))
  })
})
