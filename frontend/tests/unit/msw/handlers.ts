import { http, HttpResponse } from 'msw'

// Basic in-memory fixtures to satisfy UI needs in tests
const plants = [
  {
    uuid: 'u1',
    id: 1,
    name: 'Aloe',
    identify_hint: '',
    latest_at: '2025-01-01T00:00:00', // local time string for DailyCare logic
    water_retained_pct: 20,
    recommended_water_threshold_pct: 30,
  },
  {
    uuid: 'u2',
    id: 2,
    name: 'Monstera',
    latest_at: '2025-01-02T00:00:00',
    water_retained_pct: 50,
    recommended_water_threshold_pct: 30,
  },
]

export const handlers = [
  http.get('/api/plants/names', () => {
    // Return minimal plant data for dropdowns
    return HttpResponse.json(plants.map((p) => ({ uuid: p.uuid, name: p.name })))
  }),

  http.get('/api/plants', () => {
    // Return paginated response structure
    return HttpResponse.json({
      items: plants,
      total: plants.length,
      global_total: plants.length,
      page: 1,
      limit: 20,
      total_pages: 1,
    })
  }),

  http.get('/api/plants/uuids', ({ request }) => {
    const url = new URL(request.url)
    const needsWatering = url.searchParams.get('needs_watering')
    const needsWeighing = url.searchParams.get('needs_weighing')

    let filtered = plants
    if (needsWatering === 'true') {
      filtered = plants.filter(
        (p) =>
          p.water_retained_pct !== undefined &&
          p.water_retained_pct <= (p.recommended_water_threshold_pct || 40),
      )
    } else if (needsWatering === 'false') {
      filtered = plants.filter(
        (p) =>
          p.water_retained_pct === undefined ||
          p.water_retained_pct > (p.recommended_water_threshold_pct || 40),
      )
    }

    if (needsWeighing === 'true') {
      // Mock logic: plants need weighing if they have data?
      // For tests, let's just return all for simplicity unless specified
      filtered = plants.filter((p) => p.uuid === 'u1')
    }

    return HttpResponse.json(filtered.map((p) => p.uuid))
  }),

  // Explicitly handle a noisy test route used for error-path testing
  http.get('/api/plants/uErr3', () => {
    return HttpResponse.json({ message: 'Not found' }, { status: 404 })
  }),

  http.put('/api/plants/order', async ({ request }) => {
    // accept any payload and return ok
    return HttpResponse.json({ ok: true })
  }),

  http.get('/api/plants/:uuid', ({ params }) => {
    const p = plants.find((x) => x.uuid === params.uuid)
    if (!p) return HttpResponse.json({ message: 'Not found' }, { status: 404 })
    return HttpResponse.json(p)
  }),

  http.post('/api/plants', async () => {
    return HttpResponse.json({ uuid: 'new', id: 999 }, { status: 201 })
  }),

  http.patch('/api/plants/:uuid', async ({ request, params }) => {
    const payload = await request.json()
    const index = plants.findIndex((p) => p.uuid === params.uuid)
    if (index === -1) return HttpResponse.json({ message: 'Not found' }, { status: 404 })

    const updated = { ...plants[index], ...payload }
    plants[index] = updated
    return HttpResponse.json(updated)
  }),

  http.delete('/api/plants/:uuid', async () => {
    return HttpResponse.json({ ok: true })
  }),

  http.get('/api/plants/:uuid/measurements', () => {
    return HttpResponse.json([])
  }),

  http.delete('/api/plants/:plantId/measurements/:id', () => {
    return HttpResponse.json({ ok: true })
  }),

  // Measurements: weight
  http.post('/api/plants/:plantId/measurements/weight', async ({ request }) => {
    const payload = await request.json()
    return HttpResponse.json({
      id: 2001,
      measured_at: payload?.measured_at || '2025-01-03T00:00:00',
      measured_weight_g: payload?.measured_weight_g ?? null,
      last_dry_weight_g: payload?.last_dry_weight_g ?? null,
    })
  }),
  http.put('/api/plants/:plantId/measurements/weight/:id', async ({ request, params }) => {
    const payload = await request.json()
    return HttpResponse.json({
      id: Number(params.id),
      measured_at: payload?.measured_at || '2025-01-03T00:00:00',
      measured_weight_g: payload?.measured_weight_g ?? null,
      last_dry_weight_g: payload?.last_dry_weight_g ?? null,
    })
  }),

  // Measurements: watering
  http.post('/api/plants/:plantId/measurements/watering', async ({ request }) => {
    const payload = await request.json()
    // reflect back minimal computed values
    return HttpResponse.json({
      id: 1001,
      plant_id: payload?.plant_id,
      measured_at: payload?.measured_at || '2025-01-03T00:00:00',
      latest_at: payload?.measured_at || '2025-01-03T00:00:00',
      water_retained_pct: 40,
      water_loss_total_pct: 60,
    })
  }),
  http.put('/api/plants/:plantId/measurements/watering/:id', async ({ request, params }) => {
    const payload = await request.json()
    return HttpResponse.json({
      id: Number(params.id),
      plant_id: payload?.plant_id,
      measured_at: payload?.measured_at || '2025-01-03T00:00:00',
      latest_at: payload?.measured_at || '2025-01-03T00:00:00',
      water_retained_pct: 42,
      water_loss_total_pct: 58,
    })
  }),
  http.post('/api/plants/:plantId/measurements/vacation/watering', async ({ request }) => {
    const payload = await request.json()
    return HttpResponse.json({
      id: 1002,
      measured_at: payload?.measured_at || '2025-01-03T00:00:00',
      latest_at: payload?.measured_at || '2025-01-03T00:00:00',
      water_retained_pct: 40,
      water_loss_total_pct: 60,
    })
  }),

  // Measurements: repotting
  http.post('/api/plants/:plantId/repotting', async ({ request }) => {
    const payload = await request.json()
    return HttpResponse.json({
      id: 3001,
      measured_at: payload?.measured_at || '2025-01-03T00:00:00',
    })
  }),
  http.put('/api/plants/:plantId/repotting/:id', async ({ request, params }) => {
    const payload = await request.json()
    return HttpResponse.json({
      id: Number(params.id),
      measured_at: payload?.measured_at || '2025-01-03T00:00:00',
    })
  }),

  // Measurements: generic getById
  http.get('/api/plants/:plantId/measurements/:id', () => {
    return HttpResponse.json({
      id: 500,
      measured_at: '2025-01-10T12:34:00Z',
      measured_weight_g: 100,
      last_dry_weight_g: null,
      last_wet_weight_g: null,
      water_added_g: null,
      water_loss_total_pct: null,
      water_loss_day_pct: null,
    })
  }),
  http.get('/api/plants/measurements/approximation/watering', () => {
    return HttpResponse.json({ items: [] })
  }),
  http.get('/api/plants/measurements/approximation/weight', () => {
    return HttpResponse.json({ items: [] })
  }),
  http.get('/api/substrate-types', () => HttpResponse.json([])),
  http.get('/api/light-levels', () => HttpResponse.json([])),
  http.get('/api/pest-statuses', () => HttpResponse.json([])),
  http.get('/api/health-statuses', () => HttpResponse.json([])),
  http.get('/api/scales', () => HttpResponse.json([])),
  http.get('/api/measurement-methods', () => HttpResponse.json([])),
  http.get('/api/locations', () => HttpResponse.json({ items: [], total: 0 })),

  // Calibration
  http.get('/api/plants/measurements/calibrating', () => {
    return HttpResponse.json([])
  }),
  http.post('/api/plants/:plant_id/measurements/corrections', async ({ request }) => {
    const payload = await request.json()
    return HttpResponse.json({ ok: true, ...payload })
  }),

  // Catch-all: fail tests for unexpected method/URL combinations
  http.all('/api/*', ({ request }) => {
    return new HttpResponse(
      JSON.stringify({ detail: `Unexpected ${request.method} request` }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    )
  }),
]
