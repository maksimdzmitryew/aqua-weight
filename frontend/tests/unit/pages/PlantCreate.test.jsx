import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantCreate from '../../../src/pages/PlantCreate.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { plantsApi } from '../../../src/api/plants'
import { locationsApi } from '../../../src/api/locations'

// Mock navigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { __esModule: true, ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../../src/components/DashboardLayout.jsx', () => ({
  default: ({ children }) => <div data-testid="mock-dashboard-layout">{children}</div>,
}))

vi.mock('../../../src/components/feedback/Loader.jsx', () => ({
  default: ({ message }) => <div data-testid="loader">{message || 'Loading...'}</div>,
}))

vi.mock('../../../src/components/feedback/ErrorNotice.jsx', () => ({
  default: ({ message }) => (
    <div role="alert" data-testid="error-notice">
      {message}
    </div>
  ),
}))

vi.mock('../../../src/components/PageHeader.jsx', () => ({
  default: ({ onBack, title, actions }) => (
    <div data-testid="mock-page-header">
      <h1>{title}</h1>
      <button onClick={onBack}>Back</button>
      {actions}
    </div>
  ),
}))

vi.mock('../../../src/components/form/fields/DateTimeLocal.jsx', () => ({
  default: ({ label, form, name, required }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} type="datetime-local" {...form.register(name)} required={required} />
    </div>
  ),
}))

vi.mock('../../../src/components/form/fields/Select.jsx', () => ({
  default: ({ label, form, name, children, required, disabled }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <select id={name} {...form.register(name)} required={required} disabled={disabled}>
        {children}
      </select>
    </div>
  ),
}))

vi.mock('../../../src/components/form/fields/NumberInput.jsx', () => ({
  default: ({ label, form, name, min }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} type="number" min={min} {...form.register(name)} />
    </div>
  ),
}))

vi.mock('../../../src/components/form/fields/Checkbox.jsx', () => ({
  default: ({ label, form, name }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} type="checkbox" {...form.register(name)} />
    </div>
  ),
}))

vi.mock('../../../src/components/form/fields/TextInput.jsx', () => ({
  default: ({ label, form, name, placeholder }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} type="text" placeholder={placeholder} {...form.register(name)} />
    </div>
  ),
}))

function renderPage(initialEntries = ['/plants/new']) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={<PlantCreate />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('pages/PlantCreate', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    // Default: provide locations list for select
    server.use(
      http.get('/api/locations', () =>
        HttpResponse.json([
          { uuid: 'l1', name: 'Hall' },
          { uuid: 'l2', name: 'Kitchen' },
        ]),
      ),
      http.get('/api/substrate-types', () => HttpResponse.json([{ uuid: 'sub1', name: 'Soil' }])),
      http.get('/api/light-levels', () => HttpResponse.json([{ uuid: 'light1', name: 'Bright' }])),
      http.get('/api/pest-statuses', () => HttpResponse.json([{ uuid: 'pest1', name: 'None' }])),
      http.get('/api/health-statuses', () => HttpResponse.json([{ uuid: 'ok', name: 'Healthy' }])),
      http.get('/api/scales', () => HttpResponse.json([{ uuid: 'sc1', name: 'Scale 1' }])),
      http.get('/api/measurement-methods', () =>
        HttpResponse.json([{ uuid: 'mm1', name: 'Method 1' }]),
      ),
    )
  })

  test('submits full payload with trimmed strings and number conversions across tabs', async () => {
    // Intercept POST and capture payload for assertions after navigation
    let capturedBody = null
    server.use(
      http.post('/api/plants', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ uuid: 'pX' }, { status: 201 })
      }),
    )

    renderPage()
    // Fill General
    fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: '  My Plant  ' } })
    fireEvent.change(screen.getByLabelText(/plant type/i), {
      target: { value: '  Type  ', name: 'plant_type' },
    })
    fireEvent.change(screen.getByLabelText(/identify hint/i), {
      target: { value: '  Hint  ', name: 'identify_hint' },
    })
    fireEvent.change(screen.getByLabelText(/typical action/i), {
      target: { value: '  Action  ', name: 'typical_action' },
    })
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: '  Some description  ', name: 'description' },
    })
    fireEvent.change(screen.getByLabelText(/^notes$/i), {
      target: { value: '  Note  ', name: 'notes' },
    })
    fireEvent.change(screen.getByLabelText(/location/i), {
      target: { value: 'l2', name: 'location_id' },
    })
    fireEvent.change(screen.getByLabelText(/photo url/i), {
      target: { value: '  https://example.com/p.jpg  ', name: 'photo_url' },
    })

    // Service tab
    fireEvent.click(screen.getByRole('tab', { name: /service/i }))
    fireEvent.change(screen.getByLabelText(/default measurement method/i), {
      target: { value: 'mm1', name: 'default_measurement_method_id' },
    })
    fireEvent.change(screen.getByLabelText(/scale/i), {
      target: { value: 'sc1', name: 'scale_id' },
    })
    // Toggle checkboxes to exercise checkbox branch and mapping
    const repotted = screen.getByLabelText(/repotted/i)
    const archive = screen.getByLabelText(/archive/i)
    expect(repotted).not.toBeChecked()
    expect(archive).not.toBeChecked()
    fireEvent.click(repotted)
    fireEvent.click(archive)

    // Care tab
    fireEvent.click(screen.getByRole('tab', { name: /care/i }))
    fireEvent.change(screen.getByLabelText(/recommended water threshold/i), {
      target: { value: '35', name: 'recommended_water_threshold_pct' },
    })
    fireEvent.change(screen.getByLabelText(/biomass weight/i), {
      target: { value: '123', name: 'biomass_weight_g' },
    })
    fireEvent.change(screen.getByLabelText(/biomass last at/i), {
      target: { value: '2024-02-20T10:30', name: 'biomass_last_at' },
    })

    // Advanced tab
    fireEvent.click(screen.getByRole('tab', { name: /advanced/i }))
    fireEvent.change(screen.getByLabelText(/species name/i), {
      target: { value: '  Species  ', name: 'species_name' },
    })
    fireEvent.change(screen.getByLabelText(/botanical name/i), {
      target: { value: '  Botanical  ', name: 'botanical_name' },
    })
    fireEvent.change(screen.getByLabelText(/cultivar/i), {
      target: { value: '  Cult  ', name: 'cultivar' },
    })
    fireEvent.change(screen.getByLabelText(/substrate type/i), {
      target: { value: 'sub1', name: 'substrate_type_id' },
    })
    fireEvent.change(screen.getByLabelText(/substrate last refresh at/i), {
      target: { value: '2024-01-15T00:00', name: 'substrate_last_refresh_at' },
    })
    fireEvent.change(screen.getByLabelText(/fertilized last at/i), {
      target: { value: '2024-03-01T00:00', name: 'fertilized_last_at' },
    })
    fireEvent.change(screen.getByLabelText(/fertilizer ec \(ms\)/i), {
      target: { value: '2.5', name: 'fertilizer_ec_ms' },
    })

    // Health tab
    fireEvent.click(screen.getByRole('tab', { name: /health/i }))
    fireEvent.change(screen.getByLabelText(/light level/i), {
      target: { value: 'light1', name: 'light_level_id' },
    })
    fireEvent.change(screen.getByLabelText(/pest status/i), {
      target: { value: 'pest1', name: 'pest_status_id' },
    })
    fireEvent.change(screen.getByLabelText(/health status/i), {
      target: { value: 'ok', name: 'health_status_id' },
    })

    // Calculated tab
    fireEvent.click(screen.getByRole('tab', { name: /calculated/i }))
    fireEvent.change(screen.getByLabelText(/min dry weight/i), {
      target: { value: '10', name: 'min_dry_weight_g' },
    })
    fireEvent.change(screen.getByLabelText(/max water weight/i), {
      target: { value: '20', name: 'max_water_weight_g' },
    })

    // Save
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/plants')
    })
    // Assert normalized payload afterwards to avoid throwing inside the handler
    expect(capturedBody).toEqual(
      expect.objectContaining({
        // General
        name: 'My Plant',
        plant_type: 'Type',
        identify_hint: 'Hint',
        typical_action: 'Action',
        description: 'Some description',
        notes: 'Note',
        location_id: 'l2',
        photo_url: 'https://example.com/p.jpg',
        // Service
        default_measurement_method_id: 'mm1',
        scale_id: 'sc1',
        repotted: 1,
        archive: 1,
        // Care
        recommended_water_threshold_pct: 35,
        biomass_weight_g: 123,
        biomass_last_at: '2024-02-20T10:30',
        // Advanced
        species_name: 'Species',
        botanical_name: 'Botanical',
        cultivar: 'Cult',
        substrate_type_id: 'sub1',
        substrate_last_refresh_at: '2024-01-15T00:00',
        fertilized_last_at: '2024-03-01T00:00',
        fertilizer_ec_ms: 2.5,
        // Health
        light_level_id: 'light1',
        pest_status_id: 'pest1',
        health_status_id: 'ok',
        // Calculated
        min_dry_weight_g: 10,
        max_water_weight_g: 20,
      }),
    )
  }, 15000)

  test('backend error with string detail clears field errors without general message; all tabs handlers exercised', async () => {
    const spy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      body: { detail: 'something went wrong' },
    })

    renderPage()
    // Produce and then clear a client-side error to ensure state updates work
    const nameInput = await screen.findByRole('textbox', { name: /name/i })
    fireEvent.change(nameInput, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()

    // Now provide a valid name and trigger backend error with string detail
    fireEvent.change(nameInput, { target: { value: 'Ok' } })

    // Click through all tabs to hit each onClick handler
    const tabs = ['service', 'care', 'advanced', 'health', 'calculated', 'general']
    for (const t of tabs) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${t}$`, 'i') }))
    }

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    // No generic error is shown for string detail path
    await waitFor(() => expect(screen.queryByText(/failed to save plant/i)).not.toBeInTheDocument())
    // Field-specific error should be cleared (no "Name is required")
    expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument()
    spy.mockRestore()
  })

  test('client-side validation: trimmed empty name shows error on General tab', async () => {
    renderPage()
    const name = await screen.findByRole('textbox', { name: /name/i })
    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()
  })

  test('client-side validation: untouched empty name hits falsy branch of trim guard', async () => {
    renderPage()
    // Immediately submit the form programmatically to bypass native required blocking
    const saveBtn = await screen.findByRole('button', { name: /save/i })
    const form = saveBtn.closest('form')
    if (!form) throw new Error('form not found')
    fireEvent.submit(form)
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()
  })

  test('client-side validation: clicking Save with empty name after removing required attribute also triggers error (falsy branch)', async () => {
    renderPage()
    const nameInput = await screen.findByRole('textbox', { name: /name/i })
    // Remove native required to ensure click path invokes onSave with empty string
    nameInput.removeAttribute('required')
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()
  })

  test('successful save posts trimmed payload and navigates to /plants', async () => {
    server.use(
      http.post('/api/plants', async ({ request }) => {
        const body = await request.json()
        // Check key fields are trimmed/converted
        expect(body).toEqual(
          expect.objectContaining({
            name: 'Ficus',
            location_id: 'l1',
            recommended_water_threshold_pct: null, // left empty -> null
          }),
        )
        return HttpResponse.json({ uuid: 'p1', id: 1 }, { status: 201 })
      }),
    )

    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: /name/i }), {
      target: { value: '  Ficus  ' },
    })
    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: 'l1' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/plants')
    })
  })

  test('backend validation detail array maps to field error', async () => {
    // Mock plantsApi.create to throw axios-like error structure
    const spy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      body: {
        detail: [{ loc: ['body', 'name'], msg: 'Too short' }],
      },
    })

    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: /name/i }), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/too short/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('general error path shown when API fails without detail; locations load error rendered near select', async () => {
    // Locations error
    server.use(
      http.get('/api/locations', () => HttpResponse.json({ message: 'loc fail' }, { status: 500 })),
    )
    // plants create returns 500 without axios-like shape (ApiClient -> ApiError)
    server.use(
      http.post('/api/plants', () => HttpResponse.json({ detail: 'Too short' }, { status: 422 })),
    )

    renderPage()
    // locations error should be shown
    expect(await screen.findByText(/failed to load reference data/i)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: /name/i }), { target: { value: 'Ok' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    // Specific error for save appears (from e.message)
    expect(await screen.findByText(/too short/i)).toBeInTheDocument()
  })

  test('dark theme renders inputs with dark styles and tabs switch content', async () => {
    try {
      localStorage.setItem('theme', 'dark')
    } catch {}
    renderPage()
    const name = await screen.findByRole('textbox', { name: /name/i })
    // Dark border color
    expect(name.style.border).toContain('rgb(68, 68, 68)')
    // Switch to Service tab and back
    fireEvent.click(screen.getByRole('tab', { name: /service/i }))
    fireEvent.click(screen.getByRole('tab', { name: /general/i }))
    expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument()
  })

  test('save error with axios-like response but without detail shows generic message', async () => {
    // Mock create to reject with {response:{data:{}}} so branch without detail is hit
    const spy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      response: { data: {} },
    })

    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: /name/i }), {
      target: { value: 'Ok' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/failed to save plant/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('outer catch shows error message when navigate throws after successful save', async () => {
    // Successful create
    const spy = vi.spyOn(plantsApi, 'create').mockResolvedValue({ uuid: 'p1' })
    // Make navigate throw to reach outer catch (err.message branch)
    mockNavigate.mockImplementationOnce(() => {
      throw new Error('nav fail')
    })

    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: /name/i }), {
      target: { value: 'Ok' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/nav fail/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('Cancel button navigates back to /plants without saving', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })

  test('optional fields left empty map to null (numbers/strings) and checkboxes default to 0', async () => {
    let payload = null
    server.use(
      http.post('/api/plants', async ({ request }) => {
        payload = await request.json()
        return HttpResponse.json({ uuid: 'p-new' }, { status: 201 })
      }),
    )

    renderPage()
    // Only required field
    fireEvent.change(await screen.findByRole('textbox', { name: /name/i }), {
      target: { value: 'Only Name' },
    })

    // Do not touch optional fields, including checkboxes and number inputs
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    // Navigated after successful save
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/plants'))

    // Ensure defaults were applied as expected
    expect(payload).toEqual(
      expect.objectContaining({
        // Strings trimmed or null when empty
        plant_type: null,
        identify_hint: null,
        typical_action: null,
        description: null,
        notes: null,
        location_id: null,
        photo_url: null,
        // Service flags default to 0 when unchecked/undefined
        repotted: 0,
        archive: 0,
        // Numeric optionals become null when left empty strings
        recommended_water_threshold_pct: null,
        biomass_weight_g: null,
        fertilizer_ec_ms: null,
        min_dry_weight_g: null,
        max_water_weight_g: null,
      }),
    )
  })

  test('dark theme: visit all tabs to exercise isDark style branches across sections', async () => {
    try {
      localStorage.setItem('theme', 'dark')
    } catch {}
    renderPage()
    // Click through all tabs under dark theme so each section renders with dark styles
    const tabs = ['service', 'care', 'advanced', 'health', 'calculated', 'general']
    for (const t of tabs) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${t}$`, 'i') }))
    }
    // Spot-check a field on one of the deep tabs for dark border color
    fireEvent.click(screen.getByRole('tab', { name: /advanced/i }))
    const species = screen.getByLabelText(/species name/i)
    expect(species.style.border).toContain('rgb(68, 68, 68)')
  })

  test('locations load: non-array response maps to empty list without error', async () => {
    // Return an object instead of array to trigger Array.isArray false branch
    server.use(http.get('/api/locations', () => HttpResponse.json({ foo: 'bar' })))

    renderPage()
    // No error message
    expect(screen.queryByText(/failed to load reference data/i)).not.toBeInTheDocument()
    // Select should only have placeholder option present
    const select = await screen.findByLabelText(/location/i)
    const options = select.querySelectorAll('option')
    // first is placeholder, and no dynamic options appended
    expect(options.length).toBe(1)
    expect(options[0].textContent?.toLowerCase()).toContain('select location')
  })

  test('backend validation: missing msg falls back to "Invalid value"', async () => {
    const spy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      body: {
        // Use 'name' so the error is rendered in the UI next to the name field
        detail: [{ loc: ['body', 'name'] }],
      },
    })

    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: /name/i }), {
      target: { value: 'Ok' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/invalid value/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('outer catch fallback message when thrown error has no message', async () => {
    // Successful create
    const spy = vi.spyOn(plantsApi, 'create').mockResolvedValue({ uuid: 'p1' })
    // Throw an empty object so err.message is falsy
    mockNavigate.mockImplementationOnce(() => {
      throw {}
    })

    renderPage()
    fireEvent.change(await screen.findByRole('textbox', { name: /name/i }), {
      target: { value: 'Ok' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/failed to save plant/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('locations load effect: cleanup prevents setState after unmount (cancelled branch)', async () => {
    // Spy on locationsApi to return a deferred promise so we can unmount before it resolves
    const listSpy = vi.spyOn(locationsApi, 'list')
    let resolveFn
    const deferred = new Promise((res) => {
      resolveFn = res
    })
    listSpy.mockReturnValueOnce(deferred)

    const utils = renderPage()
    // Immediately unmount to set cancelled = true inside effect cleanup
    utils.unmount()
    // Resolve the promise after unmount; effect should not call setState due to cancelled guard
    resolveFn([])
    // allow microtasks to flush
    await Promise.resolve()
    listSpy.mockRestore()
  })

  test('PlantCreate: sort_order default coverage', async () => {
    let payload
    server.use(
      http.post('/api/plants', async ({ request }) => {
        payload = await request.json()
        return HttpResponse.json({ uuid: 'p1' }, { status: 201 })
      }),
    )
    renderPage()
    fireEvent.change(await screen.findByLabelText(/name/i), {
      target: { value: 'Test', name: 'name' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(payload).toBeDefined())
    expect(payload.sort_order).toBe(0)
  })

  test('covers remaining branches: clearing number, unchecking checkbox, and error fallback', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/plants', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ uuid: 'pX' }, { status: 201 })
      }),
    )

    renderPage()

    // 1. Cover line 111 (clearing number input)
    fireEvent.click(screen.getByRole('tab', { name: /service/i }))
    const sortOrderInput = await screen.findByLabelText(/sort order/i)
    fireEvent.change(sortOrderInput, { target: { name: 'sort_order', value: '5', type: 'number' } })
    fireEvent.change(sortOrderInput, { target: { name: 'sort_order', value: '', type: 'number' } })

    // 2. Cover line 109 (unchecking checkbox)
    const repottedCheckbox = screen.getByLabelText(/repotted/i)
    fireEvent.click(repottedCheckbox) // check it (v=1)
    fireEvent.click(repottedCheckbox) // uncheck it (v=0)

    // 3. Fill required name
    fireEvent.click(screen.getByRole('tab', { name: /general/i }))
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Test Plant' } })

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/plants'))
    expect(capturedBody.sort_order).toBe(0)
    expect(capturedBody.repotted).toBe(0)

    // 4. Cover line 201 (other error types with detail and fallback)
    const createSpy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      body: { detail: 'String error' },
    })

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.getByText('String error')).toBeInTheDocument())

    // Now hit the fallback branch by providing an empty string for detail
    createSpy.mockRejectedValueOnce({
      body: { detail: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.getByText('Failed to save plant')).toBeInTheDocument())

    createSpy.mockRestore()
  })

  test('covers reference data non-array branches', async () => {
    // Return objects instead of arrays for all reference APIs
    server.use(
      http.get('/api/substrate-types', () => HttpResponse.json({})),
      http.get('/api/light-levels', () => HttpResponse.json({})),
      http.get('/api/pest-statuses', () => HttpResponse.json({})),
      http.get('/api/health-statuses', () => HttpResponse.json({})),
      http.get('/api/scales', () => HttpResponse.json({})),
      http.get('/api/measurement-methods', () => HttpResponse.json({})),
    )

    renderPage()

    // Just wait for loading to finish
    await waitFor(() => {
      // PlantCreate doesn't have a data-testid="loader" but it uses RefsLoading state
      // which is used to show a Loader component (mocked in tests)
      expect(screen.queryByTestId('loader')).not.toBeInTheDocument()
    })
  })
})
