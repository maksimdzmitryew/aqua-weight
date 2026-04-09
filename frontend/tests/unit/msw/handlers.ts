import { http, HttpResponse } from 'msw'

// Basic in-memory fixtures to satisfy UI needs in tests
const plants = [
  {
    uuid: 'u1', id: 1, name: 'Aloe', identify_hint: '',
    latest_at: '2025-01-01T00:00:00', // local time string for DailyCare logic
    water_retained_pct: 20,
    recommended_water_threshold_pct: 30,
  },
  {
    uuid: 'u2', id: 2, name: 'Monstera',
    latest_at: '2025-01-02T00:00:00',
    water_retained_pct: 50,
    recommended_water_threshold_pct: 30,
  },
]

export const handlers = [
  http.get('/api/plants/names', () => {
    // Return minimal plant data for dropdowns
    return HttpResponse.json(
      plants.map(p => ({ uuid: p.uuid, name: p.name }))
    )
  }),

  http.get('/api/plants', () => {
    // Return paginated response structure
    return HttpResponse.json({
      items: plants,
      total: plants.length,
      global_total: plants.length,
      page: 1,
      limit: 20,
      total_pages: 1
    })
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

  http.put('/api/plants/:uuid', async () => {
    return HttpResponse.json({ ok: true })
  }),

  http.delete('/api/plants/:uuid', async () => {
    return HttpResponse.json({ ok: true })
  }),

  http.get('/api/plants/:uuid/measurements', () => {
    return HttpResponse.json([])
  }),

  // Measurements: watering
  http.post('/api/measurements/watering', async ({ request }) => {
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
  http.put('/api/measurements/watering/:id', async ({ request, params }) => {
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
  http.get('/api/measurements/approximation/watering', () => {
    return HttpResponse.json({ items: [] })
  }),
]
