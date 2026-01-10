import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  default: ({ children }) => <div data-testid="mock-dashboard-layout">{children}</div>
}))

function renderPage(initialEntries = ['/plants/new']) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={<PlantCreate />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/PlantCreate', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    // Default: provide locations list for select
    server.use(
      http.get('/api/locations', () => HttpResponse.json([
        { uuid: 'l1', name: 'Hall' },
        { uuid: 'l2', name: 'Kitchen' },
      ]))
    )
  })

  test('submits full payload with trimmed strings and number conversions across tabs', async () => {
    // Intercept POST and capture payload for assertions after navigation
    let capturedBody = null
    server.use(
      http.post('/api/plants', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ uuid: 'pX' }, { status: 201 })
      })
    )

    renderPage()
    // Fill General
    fireEvent.change(await screen.findByRole('textbox', { name: /name/i }), { target: { value: '  My Plant  ' } })
    fireEvent.change(screen.getByLabelText(/plant type/i), { target: { value: '  Type  ' } })
    fireEvent.change(screen.getByLabelText(/identify hint/i), { target: { value: '  Hint  ' } })
    fireEvent.change(screen.getByLabelText(/typical action/i), { target: { value: '  Action  ' } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: '  Some description  ' } })
    fireEvent.change(screen.getByLabelText(/^notes$/i), { target: { value: '  Note  ' } })
    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: 'l2' } })
    fireEvent.change(screen.getByLabelText(/photo url/i), { target: { value: '  https://example.com/p.jpg  ' } })

    // Service tab
    fireEvent.click(screen.getByRole('tab', { name: /service/i }))
    fireEvent.change(screen.getByLabelText(/default measurement method id/i), { target: { value: '  mm1  ' } })
    fireEvent.change(screen.getByLabelText(/scale id/i), { target: { value: '  sc1  ' } })
    // Toggle checkboxes to exercise checkbox branch and mapping
    const repotted = screen.getByLabelText(/repotted/i)
    const archive = screen.getByLabelText(/archive/i)
    expect(repotted).not.toBeChecked()
    expect(archive).not.toBeChecked()
    fireEvent.click(repotted)
    fireEvent.click(archive)

    // Care tab
    fireEvent.click(screen.getByRole('tab', { name: /care/i }))
    fireEvent.change(screen.getByLabelText(/recommended water threshold/i), { target: { value: '35' } })
    fireEvent.change(screen.getByLabelText(/biomass weight/i), { target: { value: '123' } })
    fireEvent.change(screen.getByLabelText(/biomass last at/i), { target: { value: '2024-02-20T10:30' } })

    // Advanced tab
    fireEvent.click(screen.getByRole('tab', { name: /advanced/i }))
    fireEvent.change(screen.getByLabelText(/species name/i), { target: { value: '  Species  ' } })
    fireEvent.change(screen.getByLabelText(/botanical name/i), { target: { value: '  Botanical  ' } })
    fireEvent.change(screen.getByLabelText(/cultivar/i), { target: { value: '  Cult  ' } })
    fireEvent.change(screen.getByLabelText(/substrate type id/i), { target: { value: '  sub1  ' } })
    fireEvent.change(screen.getByLabelText(/substrate last refresh at/i), { target: { value: '2024-01-15T00:00' } })
    fireEvent.change(screen.getByLabelText(/fertilized last at/i), { target: { value: '2024-03-01T00:00' } })
    fireEvent.change(screen.getByLabelText(/fertilizer ec/i), { target: { value: '2.5' } })

    // Health tab
    fireEvent.click(screen.getByRole('tab', { name: /health/i }))
    fireEvent.change(screen.getByLabelText(/light level id/i), { target: { value: '  light1  ' } })
    fireEvent.change(screen.getByLabelText(/pest status id/i), { target: { value: '  pest1  ' } })
    fireEvent.change(screen.getByLabelText(/health status id/i), { target: { value: '  ok  ' } })

    // Calculated tab
    fireEvent.click(screen.getByRole('tab', { name: /calculated/i }))
    fireEvent.change(screen.getByLabelText(/min dry weight/i), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText(/max water weight/i), { target: { value: '20' } })

    // Save
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/plants')
    })
    // Assert normalized payload afterwards to avoid throwing inside the handler
    expect(capturedBody).toEqual(expect.objectContaining({
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
    }))
  }, 15000)

  test('backend error with string detail clears field errors without general message; all tabs handlers exercised', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      response: { data: { detail: 'something went wrong' } }
    })

    renderPage()
    // Produce and then clear a client-side error to ensure state updates work
    const nameInput = await screen.findByRole('textbox', { name: /name/i })
    await user.clear(nameInput)
    await user.type(nameInput, '   ')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()

    // Now provide a valid name and trigger backend error with string detail
    await user.clear(nameInput)
    await user.type(nameInput, 'Ok')

    // Click through all tabs to hit each onClick handler
    const tabs = ['service', 'care', 'advanced', 'health', 'calculated', 'general']
    for (const t of tabs) {
      await user.click(screen.getByRole('tab', { name: new RegExp(`^${t}$`, 'i') }))
    }

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    // No generic error is shown for string detail path
    expect(screen.queryByText(/failed to save plant/i)).not.toBeInTheDocument()
    // Field-specific error should be cleared (no "Name is required")
    expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument()
    spy.mockRestore()
  })

  test('client-side validation: trimmed empty name shows error on General tab', async () => {
    const user = userEvent.setup()
    renderPage()
    const name = await screen.findByRole('textbox', { name: /name/i })
    await user.clear(name)
    await user.type(name, '   ')
    await user.click(screen.getByRole('button', { name: /save/i }))
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
    const user = userEvent.setup()
    renderPage()
    const nameInput = await screen.findByRole('textbox', { name: /name/i })
    // Remove native required to ensure click path invokes onSave with empty string
    nameInput.removeAttribute('required')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()
  })

  test('successful save posts trimmed payload and navigates to /plants', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/plants', async ({ request }) => {
        const body = await request.json()
        // Check key fields are trimmed/converted
        expect(body).toEqual(expect.objectContaining({
          name: 'Ficus',
          location_id: 'l1',
          recommended_water_threshold_pct: null, // left empty -> null
        }))
        return HttpResponse.json({ uuid: 'p1', id: 1 }, { status: 201 })
      })
    )

    renderPage()
    await user.type(await screen.findByRole('textbox', { name: /name/i }), '  Ficus  ')
    await user.selectOptions(screen.getByLabelText(/location/i), 'l1')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })

  test('backend validation detail array maps to field error', async () => {
    const user = userEvent.setup()
    // Mock plantsApi.create to throw axios-like error structure
    const spy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      response: {
        data: {
          detail: [
            { loc: ['body', 'name'], msg: 'too short' }
          ]
        }
      }
    })

    renderPage()
    await user.type(await screen.findByRole('textbox', { name: /name/i }), 'x')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/too short/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('general error path shown when API fails without detail; locations load error rendered near select', async () => {
    const user = userEvent.setup()
    // Locations error
    server.use(
      http.get('/api/locations', () => HttpResponse.json({ message: 'loc fail' }, { status: 500 }))
    )
    // plants create returns 500 without axios-like shape (ApiClient -> ApiError)
    server.use(
      http.post('/api/plants', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    )

    renderPage()
    // locations error should be shown
    expect(await screen.findByText(/failed to load locations/i)).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'Ok')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    // General error for save appears
    expect(await screen.findByText(/failed to save plant/i)).toBeInTheDocument()
  })

  test('dark theme renders inputs with dark styles and tabs switch content', async () => {
    try { localStorage.setItem('theme', 'dark') } catch {}
    const user = userEvent.setup()
    renderPage()
    const name = await screen.findByRole('textbox', { name: /name/i })
    // Dark border color
    expect(name.style.border).toContain('rgb(68, 68, 68)')
    // Switch to Service tab and back
    await user.click(screen.getByRole('tab', { name: /service/i }))
    await user.click(screen.getByRole('tab', { name: /general/i }))
    expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument()
  })

  test('save error with axios-like response but without detail shows generic message', async () => {
    const user = userEvent.setup()
    // Mock create to reject with {response:{data:{}}} so branch without detail is hit
    const spy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      response: { data: {} }
    })

    renderPage()
    await user.type(await screen.findByRole('textbox', { name: /name/i }), 'Ok')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/failed to save plant/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('outer catch shows error message when navigate throws after successful save', async () => {
    const user = userEvent.setup()
    // Successful create
    const spy = vi.spyOn(plantsApi, 'create').mockResolvedValue({ uuid: 'p1' })
    // Make navigate throw to reach outer catch (err.message branch)
    mockNavigate.mockImplementationOnce(() => { throw new Error('nav fail') })

    renderPage()
    await user.type(await screen.findByRole('textbox', { name: /name/i }), 'Ok')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/nav fail/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('Cancel button navigates back to /plants without saving', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /cancel/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })

  test('optional fields left empty map to null (numbers/strings) and checkboxes default to 0', async () => {
    const user = userEvent.setup()
    let payload = null
    server.use(
      http.post('/api/plants', async ({ request }) => {
        payload = await request.json()
        return HttpResponse.json({ uuid: 'p-new' }, { status: 201 })
      })
    )

    renderPage()
    // Only required field
    await user.type(await screen.findByRole('textbox', { name: /name/i }), 'Only Name')

    // Do not touch optional fields, including checkboxes and number inputs
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    // Navigated after successful save
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/plants'))

    // Ensure defaults were applied as expected
    expect(payload).toEqual(expect.objectContaining({
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
    }))
  })

  test('dark theme: visit all tabs to exercise isDark style branches across sections', async () => {
    try { localStorage.setItem('theme', 'dark') } catch {}
    const user = userEvent.setup()
    renderPage()
    // Click through all tabs under dark theme so each section renders with dark styles
    const tabs = ['service', 'care', 'advanced', 'health', 'calculated', 'general']
    for (const t of tabs) {
      await user.click(screen.getByRole('tab', { name: new RegExp(`^${t}$`, 'i') }))
    }
    // Spot-check a field on one of the deep tabs for dark border color
    await user.click(screen.getByRole('tab', { name: /advanced/i }))
    const species = screen.getByLabelText(/species name/i)
    expect(species.style.border).toContain('rgb(68, 68, 68)')
  })

  test('locations load: non-array response maps to empty list without error', async () => {
    // Return an object instead of array to trigger Array.isArray false branch
    server.use(
      http.get('/api/locations', () => HttpResponse.json({ foo: 'bar' }))
    )

    renderPage()
    // No error message
    expect(screen.queryByText(/failed to load locations/i)).not.toBeInTheDocument()
    // Select should only have placeholder option present
    const select = await screen.findByLabelText(/location/i)
    const options = select.querySelectorAll('option')
    // first is placeholder, and no dynamic options appended
    expect(options.length).toBe(1)
    expect(options[0].textContent?.toLowerCase()).toContain('select location')
  })

  test('backend validation: missing msg falls back to "Invalid value"', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(plantsApi, 'create').mockRejectedValue({
      response: {
        data: {
          // Use 'name' so the error is rendered in the UI next to the name field
          detail: [ { loc: ['body', 'name'] } ]
        }
      }
    })

    renderPage()
    await user.type(await screen.findByRole('textbox', { name: /name/i }), 'Ok')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/invalid value/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('outer catch fallback message when thrown error has no message', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(plantsApi, 'create').mockResolvedValue({ uuid: 'p1' })
    // Throw an empty object so err.message is falsy
    mockNavigate.mockImplementationOnce(() => { throw {} })

    renderPage()
    await user.type(await screen.findByRole('textbox', { name: /name/i }), 'Ok')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/failed to save plant/i)).toBeInTheDocument()
    spy.mockRestore()
  })

  test('locations load effect: cleanup prevents setState after unmount (cancelled branch)', async () => {
    // Spy on locationsApi to return a deferred promise so we can unmount before it resolves
    const listSpy = vi.spyOn(locationsApi, 'list')
    let resolveFn
    const deferred = new Promise((res) => { resolveFn = res })
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
})
