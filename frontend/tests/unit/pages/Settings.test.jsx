import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import Settings from '../../../src/pages/Settings.jsx'

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
})
