import { request, APIRequestContext, expect } from '@playwright/test';

export async function createApiClient(baseURL: string): Promise<APIRequestContext> {
  // Allow calling https endpoints with self-signed certs in test env
  return await request.newContext({ baseURL, ignoreHTTPSErrors: true });
}

export async function waitForAppReady(baseURL: string, timeoutMs = 30000): Promise<void> {
  const api = await createApiClient(baseURL);
  const start = Date.now();
  let lastErr: any = null;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // Frontend root should be reachable
        const fe = await api.get('/');
        const feOk = fe.status() === 200;
        // Backend health should be reachable
        const be = await api.get('/api/health');
        const beOk = be.ok();
        if (feOk && beOk) return;
      } catch (e) {
        lastErr = e;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`App not ready after ${timeoutMs}ms: ${lastErr}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  } finally {
    await api.dispose();
  }
}

export async function seed(apiBase: string) {
  await waitForAppReady(apiBase);
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