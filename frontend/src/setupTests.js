// Jest DOM adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
import '@testing-library/jest-dom';

// MSW setup for tests
import { setupServer } from 'msw/node';

// Initialize MSW server with no default handlers.
// Individual tests can import { server } from this file and call server.use(...handlers)
export const server = setupServer();

// Start server before all tests, reset after each, close after all
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
