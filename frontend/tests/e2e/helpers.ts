import { APIRequestContext, expect, Page } from '@playwright/test'

export async function resetDb(request: APIRequestContext, baseURL: string) {
  const res = await request.post(new URL('/api/test/reset', baseURL).toString())
  expect(res.ok()).toBeTruthy()
}

export async function createPlant(request: APIRequestContext, baseURL: string, name: string) {
  const res = await request.post(new URL('/api/plants', baseURL).toString(), {
    data: { name },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  // Some endpoints respond with { status, data }
  const data = body && body.status === 'success' && body.data ? body.data : body
  expect(data?.uuid || data?.id).toBeTruthy()
  // Normalize shape
  return { uuid: data.uuid || data.id, name: data.name }
}

export async function gotoPlants(page: Page) {
  await page.goto('/plants')
  await page.waitForLoadState('networkidle')
}
