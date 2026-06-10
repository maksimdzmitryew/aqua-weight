import React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import Settings from '../../../src/pages/Settings.jsx'
import { vi } from 'vitest'

// Mock AuthContext to avoid react-hot-toast resolution issues
vi.mock('../../../src/context/AuthContext.jsx', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: { global_role: 'admin' },
    isAuthenticated: true,
    status: 'authenticated',
    logout: vi.fn().mockResolvedValue({}),
  }),
}))

// Mock SettingsContext — Settings component uses useSettings()
const updateSettingsMock = vi.fn().mockImplementation((newSettings) => {
  // Mirror real SettingsContext behavior: write to localStorage
  Object.entries(newSettings).forEach(([key, value]) => {
    localStorage.setItem(key, value)
  })
  return Promise.resolve()
})

// Build a settings object from localStorage to mimic what the real
// SettingsProvider does after fetching settings from the API.
function settingsFromLocalStorage() {
  const keys = ['displayName', 'dtFormat', 'operationMode', 'defaultThreshold', 'pageSize', 'theme']
  const settings = {}
  keys.forEach((key) => {
    const val = localStorage.getItem(key)
    if (val !== null) settings[key] = val
  })
  return settings
}

vi.mock('../../../src/context/SettingsContext.jsx', () => ({
  SettingsProvider: ({ children }) => children,
  useSettings: () => ({
    settings: settingsFromLocalStorage(),
    loading: false,
    error: null,
    updateSettings: updateSettingsMock,
    refreshSettings: vi.fn().mockResolvedValue({}),
    version: null,
  }),
}))

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('pages/Settings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('validates default threshold input on change', async () => {
    renderPage()

    const threshold = screen.getByLabelText(/default watering threshold/i)

    fireEvent.change(threshold, { target: { value: '' } })
    expect(screen.getByText('Default threshold is required.')).toBeInTheDocument()

    fireEvent.change(threshold, { target: { value: '120' } })
    expect(screen.getByText('Default threshold must be between 0 and 100.')).toBeInTheDocument()

    fireEvent.change(threshold, { target: { value: '-5' } })
    expect(screen.getByText('Default threshold must be between 0 and 100.')).toBeInTheDocument()

    fireEvent.change(threshold, { target: { value: '50' } })
    expect(
      screen.queryByText('Default threshold must be between 0 and 100.'),
    ).not.toBeInTheDocument()
  })

  test('items per page selection is applied and persisted on save', async () => {
    renderPage()

    const pageSize = screen.getByLabelText(/items per page/i)

    await act(async () => {
      fireEvent.change(pageSize, { target: { value: '50' } })
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
    })

    expect(window.localStorage.getItem('pageSize')).toBe('50')
  })

  test('calls updateSettings with operation mode and threshold on save', async () => {
    renderPage()

    const operation = screen.getByLabelText(/operation mode/i)
    const threshold = screen.getByLabelText(/default watering threshold/i)

    // Use act to ensure state updates are flushed before save
    await act(async () => {
      fireEvent.change(operation, { target: { value: 'vacation' } })
      fireEvent.change(threshold, { target: { value: '45' } })
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
    })

    expect(updateSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operationMode: 'vacation',
        defaultThreshold: '45',
      }),
    )
  })

  test('applies dark theme styles when effective theme is dark', () => {
    window.localStorage.setItem('theme', 'dark')
    renderPage()

    const nameInput = screen.getByLabelText(/display name/i)
    expect(nameInput).toHaveStyle({ background: '#111827' })
  })

  test('applies light theme styles when effective theme is light', () => {
    window.localStorage.setItem('theme', 'light')
    renderPage()

    const nameInput = screen.getByLabelText(/display name/i)
    expect(nameInput).toHaveStyle({ background: '#ffffff' })
  })

  test('uses defaults when localStorage is empty', () => {
    renderPage()

    const name = screen.getByLabelText(/display name/i)
    const dt = screen.getByLabelText(/date\/time format/i)

    expect(name).toHaveValue('')
    expect(dt).toHaveValue('europe')
  })

  test('initializes fields from localStorage and saves updates with success message', async () => {
    // preset values
    window.localStorage.setItem('displayName', 'Alice')
    window.localStorage.setItem('dtFormat', 'europe')

    renderPage()

    const name = screen.getByLabelText(/display name/i)
    const dt = screen.getByLabelText(/date\/time format/i)

    expect(name).toHaveValue('Alice')
    expect(dt).toHaveValue('europe')

    // change values and submit form in single act to flush state + async save
    await act(async () => {
      fireEvent.change(name, { target: { value: 'Bob' } })
      fireEvent.change(dt, { target: { value: 'usa' } })
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
    })

    // success message appears
    expect(screen.getByText('Saved!')).toBeInTheDocument()

    // persisted
    expect(window.localStorage.getItem('displayName')).toBe('Bob')
    expect(window.localStorage.getItem('dtFormat')).toBe('usa')

    // Auto-clear behavior is managed by a timeout; we don't rely on fake timers here.
    // Just ensure the success message appeared after save.
  })

  test('changing theme select persists theme via ThemeProvider', async () => {
    renderPage()

    const theme = screen.getByLabelText(/theme/i)
    // default is whatever provider picked (localStorage or light); change to dark
    fireEvent.change(theme, { target: { value: 'dark' } })
    // ThemeProvider persists to localStorage in effect
    expect(window.localStorage.getItem('theme')).toBe('dark')

    // Change to system as well
    fireEvent.change(theme, { target: { value: 'system' } })
    expect(window.localStorage.getItem('theme')).toBe('system')
  })

  test('operation mode selection is applied and persisted on save', async () => {
    renderPage()

    const operation = screen.getByLabelText(/operation mode/i)
    // change to vacation and save
    await act(async () => {
      fireEvent.change(operation, { target: { value: 'vacation' } })
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
    })
    // persisted via the save handler
    expect(window.localStorage.getItem('operationMode')).toBe('vacation')

    // change to automatic and save
    await act(async () => {
      fireEvent.change(operation, { target: { value: 'automatic' } })
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
    })
    expect(window.localStorage.getItem('operationMode')).toBe('automatic')
  })

  test('blocks save when default threshold is invalid', async () => {
    window.localStorage.setItem('defaultThreshold', 'abc')
    renderPage()

    const threshold = screen.getByLabelText(/default watering threshold/i)
    const saveButton = screen.getByRole('button', { name: /save/i })

    fireEvent.click(saveButton)

    expect(screen.getByText('Default threshold must be a number.')).toBeInTheDocument()
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('defaultThreshold')).toBe('abc')
  })

  test('clears success message after 1.5s via timeout callback', async () => {
    // Use fake timers to execute the setTimeout callback inside Settings useEffect
    vi.useFakeTimers()
    renderPage()

    // Submit the form to trigger saving and show the success message
    const saveButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(saveButton)

    // Flush the async updateSettings promise so setSaved('Saved!') runs
    await act(async () => {
      await Promise.resolve()
    })

    // Message appears right after save
    expect(screen.getByText('Saved!')).toBeInTheDocument()

    // Advance timers past 1500ms to trigger the timeout that clears the message
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    // After act, the DOM should be updated
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument()

    vi.useRealTimers()
  }, 10000)
})
