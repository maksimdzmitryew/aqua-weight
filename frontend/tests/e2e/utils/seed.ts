import { request, APIRequestContext, expect } from '@playwright/test';

export async function createApiClient(baseURL: string): Promise<APIRequestContext> {
  // Allow calling https endpoints with self-signed certs in test env
  return await request.newContext({ baseURL, ignoreHTTPSErrors: true });
}

// The test stack starts the frontend dev server (Vite) on the fly and installs
// dependencies in the container before launching. On cold starts this can take
// well over 30s, so give it a more generous default timeout to avoid flaky
// readiness failures in CI.
export async function waitForAppReady(baseURL: string, timeoutMs = 180000): Promise<void> {
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
      await new Promise(r => setTimeout(r, 1000));
    }
  } finally {
    await api.dispose();
  }
}

export async function seed(apiBase: string) {
  await waitForAppReady(apiBase);
  const api = await createApiClient(apiBase);
  
  // Retry logic for seed
  let lastErr: any = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await api.post('/api/test/seed');
      if (res.ok()) {
        await api.dispose();
        return;
      }
      lastErr = new Error(`Seed failed with status ${res.status()}`);
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  await api.dispose();
  throw lastErr || new Error('Seed failed after retries');
}

export async function cleanup(apiBase: string) {
  // Ensure app is ready before cleanup too, in case it's called first
  await waitForAppReady(apiBase);
  const api = await createApiClient(apiBase);
  
  // Retry logic for cleanup
  let lastErr: any = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await api.post('/api/test/cleanup');
      if (res.ok()) {
        await api.dispose();
        return;
      }
      lastErr = new Error(`Cleanup failed with status ${res.status()}`);
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  await api.dispose();
  throw lastErr || new Error('Cleanup failed after retries');
}