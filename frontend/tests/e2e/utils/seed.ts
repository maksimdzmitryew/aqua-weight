import { request, APIRequestContext, expect } from '@playwright/test';

export async function createApiClient(baseURL: string): Promise<APIRequestContext> {
  // Allow calling https endpoints with self-signed certs in test env
  return await request.newContext({ baseURL, ignoreHTTPSErrors: true });
}

// The test stack starts the frontend dev server (Vite) on the fly and installs
// dependencies in the container before launching. On cold starts this can take
// well over 30s, so give it a more generous default timeout to avoid flaky
// readiness failures in CI.
let isAppReady = false;

export async function waitForAppReady(baseURL: string, timeoutMs = 180000): Promise<void> {
  if (isAppReady) return;
  // If we're already in a test run, assume the app is ready after the first check.
  // We can do a quick check once.
  const api = await createApiClient(baseURL);
  try {
    const be = await api.get('/api/health');
    if (be.ok()) {
      isAppReady = true;
      return;
    }
  } catch (e) {}
  
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
        if (feOk && beOk) {
          isAppReady = true;
          return;
        }
      } catch (e) {
        lastErr = e;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`App not ready after ${timeoutMs}ms: ${lastErr}`);
      }
      await new Promise(r => setTimeout(r, 100)); // Reduced from 1000
    }
  } finally {
    await api.dispose();
  }
}

export async function seed(apiBase: string) {
  await waitForAppReady(apiBase);
  const api = await createApiClient(apiBase);
  
  try {
    const res = await api.post('/api/test/seed');
    if (!res.ok()) {
      throw new Error(`Seed failed with status ${res.status()}`);
    }
    const data = await res.json();
    return data;
  } finally {
    await api.dispose();
  }
}

export async function cleanup(apiBase: string) {
  await waitForAppReady(apiBase);
  const api = await createApiClient(apiBase);
  
  try {
    const res = await api.post('/api/test/cleanup');
    if (!res.ok()) {
      throw new Error(`Cleanup failed with status ${res.status()}`);
    }
  } finally {
    await api.dispose();
  }
}