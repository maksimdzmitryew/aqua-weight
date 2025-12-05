// Global test setup for Vitest in jsdom environment
import '@testing-library/jest-dom/vitest'
import 'whatwg-fetch'

// MSW setup for unit tests; only active in test environment
import { server } from './tests/unit/msw/server'

// Establish API mocking before all tests.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Reset any request handlers that we may add during the tests,
// so they don't affect other tests.
afterEach(() => server.resetHandlers())

// Clean up after the tests are finished.
afterAll(() => server.close())
