import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IconButton from '../../../src/components/IconButton.jsx'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'

function renderWithTheme(ui) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('IconButton', () => {
  test('renders requested icon, sets a11y labels, calls onClick when enabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderWithTheme(
      <IconButton icon="edit" label="Edit plant" onClick={onClick} variant="ghost" size={32} />
    )

    const btn = screen.getByRole('button', { name: 'Edit plant' })
    expect(btn).toBeInTheDocument()
    // title mirrors label
    expect(btn).toHaveAttribute('title', 'Edit plant')
    // size applied via inline style
    expect(btn.style.width).toBe('32px')
    expect(btn.style.height).toBe('32px')
    // icon rendered (one svg child)
    expect(btn.querySelector('svg')).toBeTruthy()

    await user.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('hover adds filter when enabled and resets on mouse out', () => {
    renderWithTheme(<IconButton icon="view" label="View" onClick={() => {}} variant="primary" />)
    const btn = screen.getByRole('button', { name: 'View' })
    // Initially no filter
    expect(btn.style.filter).toBe('')
    fireEvent.mouseOver(btn)
    expect(btn.style.filter).toBe('brightness(0.95)')
    fireEvent.mouseOut(btn)
    expect(btn.style.filter).toBe('none')
  })

  test('disabled suppresses click and hover style; adds opacity', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderWithTheme(
      <IconButton icon="delete" label="Delete" onClick={onClick} disabled variant="danger" />
    )
    const btn = screen.getByRole('button', { name: 'Delete' })
    // Disabled path: opacity applied, cursor not-allowed
    expect(btn.style.opacity).toBe('0.6')
    expect(btn.style.cursor).toBe('not-allowed')
    // Hover should not set filter style
    fireEvent.mouseOver(btn)
    expect(btn.style.filter).toBe('')
    await user.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  test('variant styles differ in light and dark themes (covers isDark branches)', () => {
    // Light theme (default)
    renderWithTheme(
      <IconButton icon="beaker" label="Measure" variant="primary" />
    )
    let btn = screen.getByRole('button', { name: 'Measure' })
    expect(btn.style.background).toBe('rgb(238, 242, 255)') // #eef2ff
    expect(btn.style.borderColor).toBe('rgb(199, 210, 254)') // #c7d2fe
    expect(btn.style.color).toBe('rgb(30, 58, 138)') // #1e3a8a

    // Dark theme
    localStorage.setItem('theme', 'dark')
    renderWithTheme(
      <IconButton icon="beaker" label="Measure dark" variant="primary" />
    )
    btn = screen.getByRole('button', { name: 'Measure dark' })
    expect(btn.style.background).toBe('rgb(11, 19, 36)') // #0b1324
    expect(btn.style.borderColor).toBe('rgb(29, 78, 216)') // #1d4ed8
    expect(btn.style.color).toBe('rgb(199, 210, 254)') // #c7d2fe
  })

  test('unknown icon and unknown variant fall back to null icon and base styles', () => {
    renderWithTheme(
      <IconButton icon="__unknown__" label="Unknown" variant="__nope__" />
    )
    const btn = screen.getByRole('button', { name: 'Unknown' })
    // No svg rendered
    expect(btn.querySelector('svg')).toBeNull()
    // Fallback variant path (stylesByVariant[variant] || {}): background remains transparent
    expect(btn.style.background).toBe('transparent')
  })
})
