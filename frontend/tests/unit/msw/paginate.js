import { http, HttpResponse } from 'msw'

/**
 * Helper: wraps an array of plants into a paginated MSW handler response.
 * Use in place of `http.get('/api/plants', () => HttpResponse.json([...]))`.
 */
export function paginatedPlantsHandler(items) {
  return [
    http.get('/api/plants', () =>
      HttpResponse.json({
        items,
        total: items.length,
        total_pages: 1,
        page: 1,
        limit: 100,
        global_total: items.length,
      }),
    ),
    http.get('/api/plants/names', () =>
      HttpResponse.json(items.map((i) => ({ uuid: i.uuid, name: i.name }))),
    ),
    http.get('/api/plants/uuids', ({ request }) => {
      const url = new URL(request.url)
      const needsWatering = url.searchParams.get('needs_watering')
      const needsWeighing = url.searchParams.get('needs_weighing')
      const threshold = parseFloat(url.searchParams.get('defaultThreshold') || '40')

      let filtered = items
      if (needsWatering === 'true') {
        filtered = filtered.filter(
          (i) => (i.water_retained_pct ?? 100) <= (i.recommended_water_threshold_pct ?? threshold),
        )
      } else if (needsWatering === 'false') {
        filtered = filtered.filter(
          (i) => (i.water_retained_pct ?? 100) > (i.recommended_water_threshold_pct ?? threshold),
        )
      }

      if (needsWeighing === 'true') {
        filtered = filtered.filter((i) => i.needs_weighing === true)
      } else if (needsWeighing === 'false') {
        filtered = filtered.filter((i) => i.needs_weighing === false)
      }

      return HttpResponse.json(filtered.map((i) => i.uuid))
    }),
    http.get('/api/measurements/approximation/watering', () => HttpResponse.json({ items: [] })),
    http.get('/api/measurements/approximation/weight', () => HttpResponse.json({ items: [] })),
  ]
}
