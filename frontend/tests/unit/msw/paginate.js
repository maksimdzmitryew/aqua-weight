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
      })
    ),
    http.get('/api/plants/names', () =>
      HttpResponse.json(items.map(i => ({ uuid: i.uuid, name: i.name })))
    )
  ]
}
