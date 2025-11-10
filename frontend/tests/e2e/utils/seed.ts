import { request, APIRequestContext, expect } from '@playwright/test';

export async function createApiClient(baseURL: string): Promise<APIRequestContext> {
  return await request.newContext({ baseURL });
}

export async function seed(apiBase: string) {
  const api = await createApiClient(apiBase);
  const res = await api.post('/api/test/seed');
  expect(res.ok()).toBeTruthy();
  await api.dispose();
}

export async function cleanup(apiBase: string) {
  const api = await createApiClient(apiBase);
  const res = await api.post('/api/test/cleanup');
  expect(res.ok()).toBeTruthy();
  await api.dispose();
}