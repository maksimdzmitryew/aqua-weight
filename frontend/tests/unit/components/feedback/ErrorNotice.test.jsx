import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorNotice from '../../../../src/components/feedback/ErrorNotice.jsx'

describe('components/feedback/ErrorNotice', () => {
  test('returns null when message is falsy', () => {
    const { container, rerender } = render(<ErrorNotice />)
    expect(container.firstChild).toBeNull()

    rerender(<ErrorNotice message="" />)
    expect(container.firstChild).toBeNull()
  })

  test('renders alert with message and optional retry button triggers handler', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorNotice message="Network error" onRetry={onRetry} />)

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(screen.getByText('Error:')).toBeInTheDocument()
    expect(screen.getByText('Network error')).toBeInTheDocument()

    const btn = screen.getByRole('button', { name: /retry/i })
    await user.click(btn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('inline layout uses inline-flex display', () => {
    render(<ErrorNotice message="Oops" inline />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveStyle({ display: 'inline-flex' })
  })
})
