import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import WateringTimeBar from '../../../src/components/WateringTimeBar'

describe('WateringTimeBar component', () => {
  const mockWateringTime = {
    dateTime: '2025-01-01T12:00:00',
    mode: 'real-time',
    frozen: false,
    setMode: vi.fn(),
    setFrozen: vi.fn(),
    setDateTime: vi.fn(),
    getCommitDateTime: vi.fn(),
  }

  it('renders all elements correctly in real-time mode', () => {
    render(<WateringTimeBar wateringTime={mockWateringTime} />)

    expect(screen.getByLabelText(/Time:/i)).toBeInTheDocument()
    // Value might be truncated if seconds are :00, so we check if it starts with the expected minutes
    expect(screen.getByLabelText(/Time:/i).value).toMatch(/^2025-01-01T12:00/)
    expect(screen.getByLabelText(/Time:/i)).toBeDisabled()

    expect(screen.getByLabelText(/Freeze/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Freeze/i)).not.toBeChecked()

    expect(screen.getByText('real-time')).toBeInTheDocument()
    expect(screen.getByText('manual')).toBeInTheDocument()
  })

  it('enables datetime picker in manual mode', () => {
    const manualTime = { ...mockWateringTime, mode: 'manual' }
    render(<WateringTimeBar wateringTime={manualTime} />)
    expect(screen.getByLabelText(/Time:/i)).not.toBeDisabled()
  })

  it('calls setMode when chips are clicked', () => {
    render(<WateringTimeBar wateringTime={mockWateringTime} />)

    fireEvent.click(screen.getByText('manual'))
    expect(mockWateringTime.setMode).toHaveBeenCalledWith('manual')

    fireEvent.click(screen.getByText('real-time'))
    expect(mockWateringTime.setMode).toHaveBeenCalledWith('real-time')
  })

  it('calls setFrozen when checkbox is toggled', () => {
    render(<WateringTimeBar wateringTime={mockWateringTime} />)

    fireEvent.click(screen.getByLabelText(/Freeze/i))
    expect(mockWateringTime.setFrozen).toHaveBeenCalledWith(true)
  })

  it('calls setDateTime when picker value changes', () => {
    const manualTime = { ...mockWateringTime, mode: 'manual' }
    render(<WateringTimeBar wateringTime={manualTime} />)

    fireEvent.change(screen.getByLabelText(/Time:/i), { target: { value: '2025-02-02T10:00:15' } })
    expect(mockWateringTime.setDateTime).toHaveBeenCalledWith(
      expect.stringMatching(/^2025-02-02T10:00:15/),
    )
  })
})
