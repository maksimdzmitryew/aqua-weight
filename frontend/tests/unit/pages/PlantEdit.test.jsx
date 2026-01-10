import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import PlantEdit, { buildUpdatePayload } from '../../../src/pages/PlantEdit.jsx'
import { server } from '../msw/server'
import { plantsApi } from '../../../src/api/plants'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

// Mock navigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { __esModule: true, ...actual, useNavigate: () => mockNavigate }
})

function renderWithRoute(initialEntries) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/plants/:uuid/edit" element={<PlantEdit />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/PlantEdit', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    // Default mock for locations to avoid MSW warnings in every test
    server.use(
      http.get('/api/locations', () => HttpResponse.json([]))
    )
  })

  test('buildUpdatePayload throws when plant is null', () => {
    expect(() => buildUpdatePayload(null)).toThrow(/missing plant/i)
  })

  test('buildUpdatePayload throws when uuid is missing', () => {
    expect(() => buildUpdatePayload({ name: 'X' })).toThrow(/missing plant id/i)
  })

  test('buildUpdatePayload trims fields and maps empties to null; converts EC', () => {
    const plant = {
      uuid: 'uPayload',
      name: '  New  ',
      description: '  note  ',
      location_id: '  ',
      photo_url: '  ',
      default_measurement_method_id: '',
      species_name: ' Aloe  ',
      botanical_name: '  ',
      cultivar: '',
      substrate_type_id: '  ',
      substrate_last_refresh_at: '  ',
      fertilized_last_at: '  ',
      fertilizer_ec_ms: '',
      light_level_id: '  ',
      pest_status_id: '',
      health_status_id: '  ',
    }
    const built = buildUpdatePayload(plant)
    expect(built.idHex).toBe('uPayload')
    expect(built.payload).toEqual({
      name: 'New',
      description: 'note',
      location_id: null,
      photo_url: null,
      default_measurement_method_id: null,
      species_name: 'Aloe',
      botanical_name: null,
      cultivar: null,
      substrate_type_id: null,
      substrate_last_refresh_at: null,
      fertilized_last_at: null,
      fertilizer_ec_ms: null,
      light_level_id: null,
      pest_status_id: null,
      health_status_id: null,
      recommended_water_threshold_pct: null,
      min_dry_weight_g: null,
      max_water_weight_g: null,
    })
  })

  test('buildUpdatePayload handles numeric fields', () => {
    const plant = {
      uuid: 'uNumeric',
      name: 'Num',
      recommended_water_threshold_pct: '40',
      min_dry_weight_g: '200',
      max_water_weight_g: '100',
    }
    const built = buildUpdatePayload(plant)
    expect(built.payload.recommended_water_threshold_pct).toBe(40)
    expect(built.payload.min_dry_weight_g).toBe(200)
    expect(built.payload.max_water_weight_g).toBe(100)
  })

  test('buildUpdatePayload allows null original name when trimmed is empty (falls back to null)', () => {
    const plant = { uuid: 'uN', name: null }
    const built = buildUpdatePayload(plant)
    expect(built.payload.name).toBeNull()
  })

  test('prefills from router state, trims name on save, PUTs and navigates', async () => {
    const init = {
      pathname: '/plants/u1/edit',
      state: { plant: { uuid: 'u1', name: 'Old', description: 'd' } },
    }
    let called = false
    server.use(
      http.put('/api/plants/:uuid', async ({ params, request }) => {
        expect(params.uuid).toBe('u1')
        const body = await request.json()
        expect(body.name).toBe('New')
        called = true
        return HttpResponse.json({ ok: true })
      }),
      http.get('/api/locations', () => HttpResponse.json([{ uuid: 'l1', name: 'Hall' }]))
    )

    renderWithRoute([init])

    const name = await screen.findByRole('textbox', { name: /name/i })
    await userEvent.clear(name)
    await userEvent.type(name, '  New  ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(called).toBe(true)
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })

  test('trim fallback keeps original when trimmed is empty', async () => {
    const init = {
      pathname: '/plants/u1b/edit',
      state: { plant: { uuid: 'u1b', name: 'Old' } },
    }
    let seen
    server.use(
      http.put('/api/plants/:uuid', async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json({ ok: true })
      }),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute([init])
    const name = await screen.findByRole('textbox', { name: /name/i })
    await userEvent.clear(name)
    await userEvent.type(name, '   ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    // When trimmed is empty, code falls back to original value (spaces kept)
    expect(seen.name).toBe('   ')
  })

  test('loads via API when no state provided; shows loading then form', async () => {
    server.use(
      http.get('/api/plants/:uuid', ({ params }) => HttpResponse.json({ uuid: params.uuid, name: 'Loaded' })),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/u2/edit'])
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Loaded')).toBeInTheDocument()
  })

  test('locations load error is shown near select', async () => {
    server.use(
      http.get('/api/plants/:uuid', ({ params }) => HttpResponse.json({ uuid: params.uuid, name: 'P' })),
      http.get('/api/locations', () => HttpResponse.json({ message: 'fail' }, { status: 500 }))
    )
    renderWithRoute(['/plants/u3/edit'])
    expect(await screen.findByText(/failed to load locations/i)).toBeInTheDocument()
  })

  test('load error shows generic error message when API fails', async () => {
    server.use(
      http.get('/api/plants/:uuid', () => HttpResponse.text('nope', { status: 500 })),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uErr/edit'])
    // Loading first, then error after request fails
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(/failed to load plant/i)).toBeInTheDocument()
  })

  test('load error with undefined message triggers generic error (non-abort)', async () => {
    server.use(
      http.get('/api/plants/:uuid', () => HttpResponse.error()),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uErr2/edit'])
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(/failed to load plant/i)).toBeInTheDocument()
  })

  test('load error where thrown error is null still shows generic error', async () => {
    server.use(
      http.get('/api/plants/:uuid', () => HttpResponse.error()),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uErr3/edit'])
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(/failed to load plant/i)).toBeInTheDocument()
  })

  test('advanced shows ID and Created when provided', async () => {
    const init = { pathname: '/plants/uAdv/edit', state: { plant: { uuid: 'uAdv', id: 42, name: 'Adv', created_at: '2024-01-01T12:00:00Z' } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    const adv = await screen.findByRole('tab', { name: /advanced/i })
    await userEvent.click(adv)
    // Shows ID numeric value
    expect(await screen.findByText('42')).toBeInTheDocument()
    // Created label exists; DateTimeText renders within this block
    expect(screen.getByText('Created')).toBeInTheDocument()
  })

  test('normalize maps species -> species_name when species_name missing', async () => {
    const init = { pathname: '/plants/uSpec/edit', state: { plant: { uuid: 'uSpec', name: 'N', species: 'Aloe vera' } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    const adv = await screen.findByRole('tab', { name: /advanced/i })
    await userEvent.click(adv)
    const speciesInput = await screen.findByRole('textbox', { name: /species name/i })
    expect(speciesInput).toHaveValue('Aloe vera')
  })

  test('advanced fertilizer EC input uses empty string when value is undefined (nullish coalesce)', async () => {
    const init = { pathname: '/plants/uECU/edit', state: { plant: { uuid: 'uECU', name: 'E' } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    const adv = await screen.findByRole('tab', { name: /advanced/i })
    await userEvent.click(adv)
    const ec = await screen.findByRole('spinbutton', { name: /fertilizer ec/i })
    expect(ec.value).toBe('')
  })

  test('advanced fertilizer EC renders 0 without falling back to empty', async () => {
    const init = { pathname: '/plants/uEC0/edit', state: { plant: { uuid: 'uEC0', name: 'E', fertilizer_ec_ms: 0 } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    const adv = await screen.findByRole('tab', { name: /advanced/i })
    await userEvent.click(adv)
    const ec = await screen.findByRole('spinbutton', { name: /fertilizer ec/i })
    expect(ec).toHaveValue(0)
  })

  test('advanced fertilizer EC input is empty when value is null', async () => {
    const init = { pathname: '/plants/uECnull/edit', state: { plant: { uuid: 'uECnull', name: 'E', fertilizer_ec_ms: null } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    const adv = await screen.findByRole('tab', { name: /advanced/i })
    await userEvent.click(adv)
    const ec = await screen.findByRole('spinbutton', { name: /fertilizer ec/i })
    expect(ec.value).toBe('')
  })

  test('plant load Error with empty message shows generic error (covers msg falsy path)', async () => {
    server.use(
      http.get('/api/plants/:uuid', () => HttpResponse.json({ message: '' }, { status: 500 })),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uErrEmptyMsg/edit'])
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(/failed to load plant/i)).toBeInTheDocument()
  })

  test('plant load throws undefined error object and shows generic error', async () => {
    server.use(
      http.get('/api/plants/:uuid', () => HttpResponse.error()),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uErrUndef/edit'])
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(/failed to load plant/i)).toBeInTheDocument()
  })

  test('plant load Error with non-empty message shows generic error (non-abort)', async () => {
    server.use(
      http.get('/api/plants/:uuid', () => HttpResponse.json({ message: 'Boom' }, { status: 500 })),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uErrBoom/edit'])
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(/failed to load plant/i)).toBeInTheDocument()
  })

  test('missing uuid on save alerts error', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    // Use a matching route but provide state without uuid to trigger branch inside onSave
    const init = { pathname: '/plants/any/edit', state: { plant: { name: 'NoId' } } }
    // locations
    server.use(
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute([init])
    await userEvent.click(await screen.findByRole('button', { name: /save/i }))
    expect(alertSpy).toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  test('dark theme styles and tabs switch', async () => {
    try { localStorage.setItem('theme', 'dark') } catch {}
    const init = { pathname: '/plants/u4/edit', state: { plant: { uuid: 'u4', name: 'Dark' } } }
    server.use(
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    const { container } = renderWithRoute([init])
    const input = await screen.findByRole('textbox', { name: /name/i })
    // dark border color rgb(55,65,81)
    expect(input.style.borderColor).toBe('rgb(55, 65, 81)')
    // Wait for tab to be available to avoid race conditions
    const advTab = await screen.findByRole('tab', { name: /advanced/i })
    await userEvent.click(advTab)
    // Divider in Advanced has dark border color
    const idLabelDark = await screen.findByText('ID')
    const dividerDark = idLabelDark.parentElement
    expect(dividerDark.style.borderTop).toContain('31, 41, 55')
    await userEvent.click(screen.getByRole('tab', { name: /health/i }))
    await userEvent.click(screen.getByRole('tab', { name: /general/i }))
    expect(container).toBeTruthy()
  })

  test('light theme advanced divider is rendered', async () => {
    const init = { pathname: '/plants/u4l/edit', state: { plant: { uuid: 'u4l', name: 'Light Name' } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    const adv = await screen.findByRole('tab', { name: /advanced/i })
    await userEvent.click(adv)
    const idLabel = await screen.findByText('ID')
    const block = idLabel.parentElement // outer block has borderTop inline style
    expect(block.style.borderTop).toContain('solid')
  })

  test('AbortError during plant load is ignored (no error shown)', async () => {
    // No initial state -> triggers load via API
    // Make GET throw AbortError; locations still load to complete effects
    server.use(
      http.get('/api/plants/:uuid', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      }),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uAbort/edit'])
    // Loading appears, then disappears; no error message rendered
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    // Wait for static header/link outside the conditional form
    await screen.findByRole('link', { name: /back to plants/i })
    expect(screen.queryByText(/failed to load plant/i)).not.toBeInTheDocument()
  })

  test('plant load error message contains "abort" (non-AbortError) is also ignored', async () => {
    server.use(
      http.get('/api/plants/:uuid', () => {
        throw new Error('request aborted by user')
      }),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uAbortMsg/edit'])
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    await screen.findByRole('link', { name: /back to plants/i })
    expect(screen.queryByText(/failed to load plant/i)).not.toBeInTheDocument()
  })

  test('locations non-array response falls back to empty options', async () => {
    const init = { pathname: '/plants/uLoc/edit', state: { plant: { uuid: 'uLoc', name: 'L' } } }
    server.use(
      http.get('/api/locations', () => HttpResponse.json({ ok: true })),
    )
    renderWithRoute([init])
    const select = await screen.findByLabelText(/location/i)
    const options = within(select).getAllByRole('option')
    // only the default placeholder option
    expect(options).toHaveLength(1)
  })

  test('advanced EC input shows empty when initial value is empty string', async () => {
    const init = { pathname: '/plants/uECEmpty/edit', state: { plant: { uuid: 'uECEmpty', name: 'E', fertilizer_ec_ms: '' } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    const adv = await screen.findByRole('tab', { name: /advanced/i })
    await userEvent.click(adv)
    const ec = await screen.findByRole('spinbutton', { name: /fertilizer ec/i })
    expect(ec.value).toBe('')
  })

  test('normalize early return path when plant API returns null', async () => {
    server.use(
      http.get('/api/plants/:uuid', () => HttpResponse.json(null)),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute(['/plants/uNull/edit'])
    // loading then no error shown; form not present because plant is null
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    await screen.findByRole('link', { name: /back to plants/i })
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByText(/failed to load plant/i)).not.toBeInTheDocument()
  })

  test('cancel navigates back to /plants', async () => {
    const init = { pathname: '/plants/u5/edit', state: { plant: { uuid: 'u5', name: 'X' } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/plants')
  })

  test('fertilizer_ec_ms empty string is sent as null', async () => {
    const init = { pathname: '/plants/u6/edit', state: { plant: { uuid: 'u6', name: 'F1', fertilizer_ec_ms: '' } } }
    let body
    server.use(
      http.put('/api/plants/:uuid', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ok: true })
      }),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute([init])
    await userEvent.click(await screen.findByRole('button', { name: /save/i }))
    expect(body.fertilizer_ec_ms).toBeNull()
  })

  test('fertilizer_ec_ms numeric string is converted to number and rendered', async () => {
    const init = { pathname: '/plants/u7/edit', state: { plant: { uuid: 'u7', name: 'F2', fertilizer_ec_ms: '2.5' } } }
    let body
    server.use(
      http.put('/api/plants/:uuid', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ok: true })
      }),
      http.get('/api/locations', () => HttpResponse.json([]))
    )
    renderWithRoute([init])
    // Ensure the input shows a non-empty value path (covers ?? branch)
    const advTab = await screen.findByRole('tab', { name: /advanced/i })
    await userEvent.click(advTab)
    const ecInput = await screen.findByRole('spinbutton', { name: /fertilizer ec/i })
    expect(ecInput).toHaveValue(2.5)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(body.fertilizer_ec_ms).toBe(2.5)
  })

  test('save failure without error message alerts default and does not navigate', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    // Mock update to throw an Error without message
    const updateSpy = vi.spyOn(plantsApi, 'update').mockImplementation(async () => {
      throw new Error('')
    })
    const init = { pathname: '/plants/u8/edit', state: { plant: { uuid: 'u8', name: 'Err' } } }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    await userEvent.click(await screen.findByRole('button', { name: /save/i }))
    expect(alertSpy).toHaveBeenCalledWith('Failed to save')
    expect(mockNavigate).not.toHaveBeenCalled()
    updateSpy.mockRestore()
    alertSpy.mockRestore()
  })

  test('buildUpdatePayload exhaustive coverage', () => {
    // Test with all fields as empty strings or null
    const p1 = {
      uuid: 'uuid1',
      name: ' ', // trimmedName will be ' ' (hits || plant.name)
      description: ' ', // trimmedDescription will be null
      location_id: ' ',
      photo_url: ' ',
      default_measurement_method_id: '',
      species_name: ' ',
      botanical_name: null,
      cultivar: undefined,
      recommended_water_threshold_pct: '',
      min_dry_weight_g: null,
      max_water_weight_g: undefined,
    }
    const b1 = buildUpdatePayload(p1)
    expect(b1.payload.name).toBe(' ')
    expect(b1.payload.description).toBeNull()

    // Test with values that don't need trimming/fallback
    const p2 = {
      uuid: 'uuid2',
      name: 'Aloe',
      description: 'D',
      recommended_water_threshold_pct: 0,
      species_name: 'Aloe vera' // hits left side of ?? in normalize later, but here test payload
    }
    const b2 = buildUpdatePayload(p2)
    expect(b2.payload.name).toBe('Aloe')
    expect(b2.payload.recommended_water_threshold_pct).toBe(0)
    expect(b2.payload.species_name).toBe('Aloe vera')
  })

  test('normalize additional branches', async () => {
    // We can't easily export normalize, but we can hit it via prefills
    // Case where species_name is already present (hits left side of ?? species)
    const init = {
      pathname: '/plants/uNorm/edit',
      state: { plant: { uuid: 'uNorm', name: 'N', species_name: 'S', species: 'Ignore' } }
    }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])
    await userEvent.click(screen.getByRole('tab', { name: /advanced/i }))
    expect(screen.getByDisplayValue('S')).toBeInTheDocument()
  })

  test('calculated tab and normalize location fallback', async () => {
    const init = {
      pathname: '/plants/uCalc/edit',
      state: {
        plant: {
          uuid: 'uCalc',
          name: 'Calc',
          location: 'loc-uuid', // triggers location_id fallback in normalize
          recommended_water_threshold_pct: 30,
          min_dry_weight_g: 150,
          max_water_weight_g: 80,
        }
      }
    }
    server.use(http.get('/api/locations', () => HttpResponse.json([{ uuid: 'loc-uuid', name: 'Kitchen' }])))
    renderWithRoute([init])

    // Verify location fallback worked
    const select = await screen.findByLabelText(/location/i)
    expect(select).toHaveValue('loc-uuid')

    const calcTab = await screen.findByRole('tab', { name: /calculated/i })
    await userEvent.click(calcTab)

    const thresh = await screen.findByLabelText(/recommended water threshold/i)
    const minDry = screen.getByLabelText(/min dry weight/i)
    const maxWater = screen.getByLabelText(/max water weight/i)
    
    expect(thresh).toHaveValue(30)
    expect(minDry).toHaveValue(150)
    expect(maxWater).toHaveValue(80)

    // Type into these to exercise onChange
    await userEvent.clear(thresh)
    await userEvent.type(thresh, '35')
    expect(thresh).toHaveValue(35)

    await userEvent.clear(minDry)
    await userEvent.type(minDry, '200')
    expect(minDry).toHaveValue(200)

    await userEvent.clear(maxWater)
    await userEvent.type(maxWater, '100')
    expect(maxWater).toHaveValue(100)
  })

  test('normalize fallbacks with minimal plant data', async () => {
    const init = {
      pathname: '/plants/uMin/edit',
      state: {
        plant: {
          uuid: 'uMin',
          name: 'Min',
          // missing everything else
        }
      }
    }
    server.use(http.get('/api/locations', () => HttpResponse.json([])))
    renderWithRoute([init])

    // Check Calculated tab with empty values
    const calcTab = await screen.findByRole('tab', { name: /calculated/i })
    await userEvent.click(calcTab)
    expect(await screen.findByLabelText(/recommended water threshold/i)).toHaveValue(null)
    expect(screen.getByLabelText(/min dry weight/i)).toHaveValue(null)
    expect(screen.getByLabelText(/max water weight/i)).toHaveValue(null)

    // Check Health tab with empty values
    await userEvent.click(screen.getByRole('tab', { name: /health/i }))
    expect(screen.getByLabelText(/light level id/i)).toHaveValue('')
    expect(screen.getByLabelText(/pest status id/i)).toHaveValue('')
    expect(screen.getByLabelText(/health status id/i)).toHaveValue('')
  })

  test('exercises unmount cleanup functions', async () => {
    const { unmount } = renderWithRoute(['/plants/uUnmount/edit'])
    // Just unmount to trigger cleanup arrows
    unmount()
  })
})
