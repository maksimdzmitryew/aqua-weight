import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { act } from 'react-dom/test-utils'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import Settings from '../../../src/pages/Settings.jsx'
import { vi } from 'vitest'

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('pages/Settings', () => {
  beforeEach(() => {
    window.localStorage.clear()
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

    const user = userEvent.setup()

    renderPage()

    const name = screen.getByLabelText(/display name/i)
    const dt = screen.getByLabelText(/date\/time format/i)

    expect(name).toHaveValue('Alice')
    expect(dt).toHaveValue('europe')

    // change values
    await user.clear(name)
    await user.type(name, 'Bob')
    await user.selectOptions(dt, 'usa')

    // submit form
    await user.click(screen.getByRole('button', { name: /save/i }))
    // success message appears
    expect(screen.getByText('Saved!')).toBeInTheDocument()

    // persisted
    expect(window.localStorage.getItem('displayName')).toBe('Bob')
    expect(window.localStorage.getItem('dtFormat')).toBe('usa')

    // Auto-clear behavior is managed by a timeout; we don't rely on fake timers here.
    // Just ensure the success message appeared after save.
  })

  test('changing theme select persists theme via ThemeProvider', async () => {
    const user = userEvent.setup()
    renderPage()

    const theme = screen.getByLabelText(/theme/i)
    // default is whatever provider picked (localStorage or light); change to dark
    await user.selectOptions(theme, 'dark')
    // ThemeProvider persists to localStorage in effect
    expect(window.localStorage.getItem('theme')).toBe('dark')

    // Change to system as well
    await user.selectOptions(theme, 'system')
    expect(window.localStorage.getItem('theme')).toBe('system')
  })

  test('vacation mode selection is applied and persisted on save', async () => {
    const user = userEvent.setup()
    renderPage()

    const vacation = screen.getByLabelText(/vacation mode/i)
    // change to enabled
    await user.selectOptions(vacation, 'enabled')
    // save
    await user.click(screen.getByRole('button', { name: /save/i }))
    // persisted via the save handler
    expect(window.localStorage.getItem('vacationMode')).toBe('enabled')
  })

  test('clears success message after 1.5s via timeout callback', async () => {
    // Use fake timers to execute the setTimeout callback inside Settings useEffect
    vi.useFakeTimers()
    renderPage()

    // Submit the form to trigger saving and show the success message
    const saveButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(saveButton)

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
