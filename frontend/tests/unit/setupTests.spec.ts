import { afterAll, describe, expect, test, vi } from 'vitest'

// Mock msw/node before importing the setup file to avoid starting a real MSW server
vi.mock('msw/node', () => {
  // Define fns inside the factory to avoid TDZ and vitest hoisting issues
  const mockServer = {
    listen: vi.fn(),
    resetHandlers: vi.fn(),
    close: vi.fn(),
  }
  return {
    setupServer: () => mockServer,
  }
})

// Import the Jest-style setup file under test (this should register beforeAll/afterEach/afterAll)
import * as jestStyleSetup from '../../src/setupTests.js'
import { setupServer as getMockServer } from 'msw/node'

describe('src/setupTests.js (Jest-style) coverage', () => {
  test('exports a server instance', () => {
    // Ensure the module exported the mocked server
    expect(jestStyleSetup).toHaveProperty('server')
  })

  test('jest-dom matchers are available via global setup', () => {
    // Our Vitest global setup already loads jest-dom; this assertion confirms matchers exist
    expect(document.body).toBeEmptyDOMElement()
  })

  test('beforeAll starts MSW server with bypass for unhandled requests', () => {
    const mockServer = getMockServer()
    expect(mockServer.listen).toHaveBeenCalledTimes(1)
    expect(mockServer.listen).toHaveBeenCalledWith({ onUnhandledRequest: 'bypass' })
  })

  test('afterEach resets handlers between tests (should have run after previous test)', () => {
    // By the time this test runs, one afterEach from the previous test should have executed
    const mockServer = getMockServer()
    expect(mockServer.resetHandlers.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

})
