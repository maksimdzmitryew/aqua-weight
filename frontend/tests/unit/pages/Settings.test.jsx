import React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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

    renderPage()

    const name = screen.getByLabelText(/display name/i)
    const dt = screen.getByLabelText(/date\/time format/i)

    expect(name).toHaveValue('Alice')
    expect(dt).toHaveValue('europe')

    // change values
    fireEvent.change(name, { target: { value: 'Bob' } })
    fireEvent.change(dt, { target: { value: 'usa' } })

    // submit form
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
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
    // change to vacation
    fireEvent.change(operation, { target: { value: 'vacation' } })
    // save
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    // persisted via the save handler
    expect(window.localStorage.getItem('operationMode')).toBe('vacation')

    // change to automatic
    fireEvent.change(operation, { target: { value: 'automatic' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(window.localStorage.getItem('operationMode')).toBe('automatic')
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
