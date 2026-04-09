import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DriftNotification from '../../../src/components/DriftNotification'

describe('DriftNotification Component', () => {
  it('renders the notification message', () => {
    render(<DriftNotification onRefresh={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText(/Plants list updated/)).toBeInTheDocument()
    expect(screen.getByText(/Page might have shifted/)).toBeInTheDocument()
  })

  it('renders refresh button', () => {
    render(<DriftNotification onRefresh={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })

  it('renders dismiss button', () => {
    render(<DriftNotification onRefresh={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
  })

  it('calls onRefresh when refresh button is clicked', () => {
    const onRefresh = vi.fn()
    render(<DriftNotification onRefresh={onRefresh} onDismiss={vi.fn()} />)

    const refreshButton = screen.getByRole('button', { name: /refresh/i })
    fireEvent.click(refreshButton)

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn()
    render(<DriftNotification onRefresh={vi.fn()} onDismiss={onDismiss} />)

    const dismissButton = screen.getByRole('button', { name: /dismiss/i })
    fireEvent.click(dismissButton)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders with info icon', () => {
    render(<DriftNotification onRefresh={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('ℹ️')).toBeInTheDocument()
  })

  it('has proper ARIA attributes for accessibility', () => {
    render(<DriftNotification onRefresh={vi.fn()} onDismiss={vi.fn()} />)
    const notification = screen.getByRole('alert')
    expect(notification).toHaveAttribute('aria-live', 'polite')
  })
})
