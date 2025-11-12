# Frontend Testing and Stories Guide

This guide describes how we test the frontend and how to run Storybook for component documentation and visual baselines.

## Commands

- Dev server:
  - `npm run dev` (from `frontend/`)

- End-to-End tests (Playwright):
  - Install browsers: `npm run e2e:install`
  - Run headless: `npm run e2e`
  - Run headed: `npm run e2e:headed`
  - Show last report: `npm run e2e:report`

- Storybook (component docs and visual spot checks):
  - Start: `npm run storybook`
  - Build static: `npm run build-storybook`

## Philosophy and Patterns

- Prefer React Testing Library queries by role/label/text to reflect user-facing behavior.
- Mock network with `msw` in component/integration tests; keep mocks close to the tests that need them.
- Keep tests readable with AAA (Arrange-Act-Assert) or Given-When-Then.
- For forms, test accessibility attributes (aria-invalid, aria-describedby) and required/disabled states.

## Structure

- Component tests: `frontend/src/__tests__/`
- E2E tests: `frontend/tests/e2e/`
- Stories colocated: e.g., `src/components/**/Component.stories.jsx`

## Storybook as Living Docs

- Stories for core form fields (TextInput, Select) demonstrate default, error, and disabled states.
- Stories are wrapped with `ThemeProvider` via a global decorator, so components render with the app theme context.
- Optional: Integrate Chromatic for cloud snapshots if desired; see https://www.chromatic.com/ (credentials required). Not enabled by default.

## Example Patterns

```jsx
// AAA example in React Testing Library
// Arrange
render(<MyForm />)

// Act
await user.type(screen.getByLabelText('Name'), 'Monstera')
await user.click(screen.getByRole('button', { name: /save/i }))

// Assert
expect(await screen.findByText(/created successfully/i)).toBeInTheDocument()
```

## Running in Docker (optional)

- E2E tests are supported by the test docker-compose stack.
  - Start stack: `docker compose -f docker-compose.test.yml up -d --build`
  - Exec E2E container (if needed): `docker compose -f docker-compose.test.yml exec e2e bash`

## Tips

- Use playwright selectors by role and label for resilience.
- Keep network behavior deterministic with `msw` when testing components in isolation.
