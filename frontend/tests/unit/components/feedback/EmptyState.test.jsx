import React from 'react'
import { render, screen } from '@testing-library/react'
import EmptyState from '../../../../src/components/feedback/EmptyState.jsx'

describe('components/feedback/EmptyState', () => {
  test('returns null when neither title nor description provided', () => {
    const { container } = render(<EmptyState />)
    expect(container.firstChild).toBeNull()
  })

  test('renders with title only and role note', () => {
    render(<EmptyState title="Nothing here" />)
    const note = screen.getByRole('note')
    expect(note).toBeInTheDocument()
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  test('renders description and children action', () => {
    render(
      <EmptyState title="No plants" description="Create your first one.">
        <button>New</button>
      </EmptyState>
    )
    expect(screen.getByRole('note')).toBeInTheDocument()
    expect(screen.getByText('No plants')).toBeInTheDocument()
    expect(screen.getByText('Create your first one.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
  })
})
