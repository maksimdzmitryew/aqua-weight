import React from 'react'
import { render, waitFor, fireEvent } from '@testing-library/react'
import { act } from 'react'
import { ThemeProvider, useTheme } from '../../src/ThemeContext.jsx'

// Helper to mock window.matchMedia with desired API shape
function withMatchMedia(mockMq, fn) {
  const original = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => mockMq,
  })
  try {
    return fn()
  } finally {
    // restore
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: original,
    })
  }
}

test('ThemeProvider registers and cleans up listener using addEventListener/removeEventListener', () => {
  // Arrange a modern MediaQueryList mock
  const calls = { added: null, removed: null }
  const mq = {
    matches: false,
    addEventListener: vi.fn((type, handler) => {
      calls.added = handler
    }),
    removeEventListener: vi.fn((type, handler) => {
      calls.removed = handler
    }),
  }

  withMatchMedia(mq, () => {
    const { unmount } = render(
      <ThemeProvider>
        <div>child</div>
      </ThemeProvider>
    )

    // Effect should have registered the handler
    expect(mq.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(typeof calls.added).toBe('function')

    // Unmount triggers cleanup, removing the same handler
    unmount()
    expect(mq.removeEventListener).toHaveBeenCalledWith('change', calls.added)
    expect(calls.removed).toBe(calls.added)
  })
})

test('persists theme to localStorage but swallows errors (catch path)', async () => {
  const spy = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('quota exceeded')
    })

  // Render will trigger the persistence effect
  render(
    <ThemeProvider>
      <div>child</div>
    </ThemeProvider>
  )

  await waitFor(() => {
    expect(spy).toHaveBeenCalled()
  })

  spy.mockRestore()
})

test('effectiveTheme uses systemTheme when theme is set to system', async () => {
  // Force initial stored theme to 'system'
  const getSpy = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation((key) => (key === 'theme' ? 'system' : null))

  // Mock system preference to dark
  const mq = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const originalMatchMedia = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => mq,
  })

  render(
    <ThemeProvider>
      <div>child</div>
    </ThemeProvider>
  )

  // The document element should reflect dark theme via effectiveTheme
  await waitFor(() => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  getSpy.mockRestore()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
})

test('ThemeProvider falls back to addListener/removeListener and cleans up', () => {
  // Arrange a legacy MediaQueryList mock (no addEventListener API)
  const calls = { added: null, removed: null }
  const mq = {
    matches: true,
    addListener: vi.fn((handler) => {
      calls.added = handler
    }),
    removeListener: vi.fn((handler) => {
      calls.removed = handler
    }),
  }

  withMatchMedia(mq, () => {
    const { unmount } = render(
      <ThemeProvider>
        <div>child</div>
      </ThemeProvider>
    )

    // Registered via legacy API
    expect(mq.addListener).toHaveBeenCalledWith(expect.any(Function))
    expect(typeof calls.added).toBe('function')

    // Cleanup uses corresponding legacy method with the same handler
    unmount()
    expect(mq.removeListener).toHaveBeenCalledWith(calls.added)
    expect(calls.removed).toBe(calls.added)
  })
})

test('useTheme hook provides theme values and setTheme updates effective theme', async () => {
  // Arrange: ensure matchMedia exists but does not force dark
  const mq = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const originalMatchMedia = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => mq,
  })

  // Ensure initial stored theme is not forcing 'system' from other tests
  const getSpy = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation((key) => (key === 'theme' ? null : null))

  // Consumer component using the hook directly
  function Consumer() {
    const { theme, effectiveTheme, setTheme } = useTheme()
    return (
      <div>
        <span data-testid="theme">{theme}</span>
        <span data-testid="effective">{effectiveTheme}</span>
        <button onClick={() => setTheme('dark')}>dark</button>
      </div>
    )
  }

  const { findByTestId, getByText } = render(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>
  )

  // Initially light
  expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  expect((await findByTestId('theme')).textContent).toBe('light')
  expect((await findByTestId('effective')).textContent).toBe('light')

  // Act: switch to dark via setTheme from the hook (wrap event in React act)
  fireEvent.click(getByText('dark'))

  await waitFor(() => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
  expect((await findByTestId('theme')).textContent).toBe('dark')
  expect((await findByTestId('effective')).textContent).toBe('dark')

  // restore matchMedia
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
  getSpy.mockRestore()
})

test('useTheme outside ThemeProvider returns default context and noop setTheme', async () => {
  // Ensure document starts clean
  document.documentElement.removeAttribute('data-theme')

  function LoneConsumer() {
    const { theme, effectiveTheme, setTheme } = useTheme()
    return (
      <div>
        <span data-testid="theme">{theme}</span>
        <span data-testid="effective">{effectiveTheme}</span>
        <button onClick={() => setTheme('dark')}>noop</button>
      </div>
    )
  }

  const { findByTestId, getByText } = render(<LoneConsumer />)

  // Defaults from createContext
  expect((await findByTestId('theme')).textContent).toBe('light')
  expect((await findByTestId('effective')).textContent).toBe('light')

  // Clicking should invoke the default no-op function without throwing
  getByText('noop').click()

  // Still default values; and no data-theme was set since no provider effect
  expect((await findByTestId('theme')).textContent).toBe('light')
  expect((await findByTestId('effective')).textContent).toBe('light')
  expect(document.documentElement.getAttribute('data-theme')).toBe(null)
})

test('system theme updates when media query change handler fires', async () => {
  // Start with stored theme = 'system'
  const getSpy = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation((key) => (key === 'theme' ? 'system' : null))

  // Prepare MQ mock capturing the handler
  const calls = { handler: null }
  const mq = {
    matches: false,
    addEventListener: vi.fn((type, h) => {
      calls.handler = h
    }),
    removeEventListener: vi.fn(),
  }
  const originalMatchMedia = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => mq,
  })

  // Render
  render(
    <ThemeProvider>
      <div>child</div>
    </ThemeProvider>
  )

  // Initially light because mq.matches = false
  expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  expect(calls.handler).toBeTypeOf('function')

  // Flip to dark and fire the handler (simulating change event)
  mq.matches = true
  act(() => {
    calls.handler()
  })

  await waitFor(() => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  // restore
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
  getSpy.mockRestore()
})

test('document data-theme attribute is cleaned up on unmount', async () => {
  const mq = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const originalMatchMedia = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => mq,
  })

  function Consumer() {
    const { setTheme } = useTheme()
    React.useEffect(() => {
      setTheme('dark')
    }, [setTheme])
    return <div>child</div>
  }

  const { unmount } = render(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>
  )

  await waitFor(() => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  unmount()
  expect(document.documentElement.getAttribute('data-theme')).toBe(null)

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
})
