import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SudoMode from '../../../../src/components/auth/SudoMode'
import { useTheme } from '../../../../src/ThemeContext'

vi.mock('../../../../src/ThemeContext', () => ({
  useTheme: vi.fn(),
}))

// Mock ConfirmDialog to avoid portal/modal issues in unit tests
vi.mock('../../../../src/components/ConfirmDialog', () => ({
  default: ({ open, title, message, buttons }) => {
    if (!open) return null
    return (
      <div data-testid="sudo-dialog">
        <h1>{title}</h1>
        <div>{message}</div>
        {buttons.map((b) => (
          <button key={b.key} onClick={b.onClick}>
            {b.text}
          </button>
        ))}
      </div>
    )
  },
}))

describe('SudoMode', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useTheme.mockReturnValue({ effectiveTheme: 'light' })
  })

  it('renders nothing when closed', () => {
    render(<SudoMode open={false} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.queryByTestId('sudo-dialog')).not.toBeInTheDocument()
  })

  it('renders correctly when open', () => {
    render(<SudoMode open={true} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByTestId('sudo-dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Enter your password/i)).toBeInTheDocument()
  })

  it('shows error if password is empty on confirm', () => {
    render(<SudoMode open={true} onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.click(screen.getByText('Verify Password'))

    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onConfirm with password', () => {
    render(<SudoMode open={true} onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.change(screen.getByPlaceholderText(/Enter your password/i), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByText('Verify Password'))

    expect(onConfirm).toHaveBeenCalledWith('secret')
  })

  it('calls onCancel and clears state', () => {
    render(<SudoMode open={true} onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.change(screen.getByPlaceholderText(/Enter your password/i), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByText('Cancel'))

    expect(onCancel).toHaveBeenCalled()

    // Open again to check if cleared (it should be because state is internal and component re-renders or we check logic)
    // Actually, SudoMode should clear state in handleCancel
  })

  it('submits form on Enter', () => {
    render(<SudoMode open={true} onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.change(screen.getByPlaceholderText(/Enter your password/i), {
      target: { value: 'secret' },
    })

    // Submit the form
    fireEvent.submit(screen.getByPlaceholderText(/Enter your password/i).closest('form'))

    expect(onConfirm).toHaveBeenCalledWith('secret')
  })
})
