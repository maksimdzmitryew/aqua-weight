import React from 'react'
import { render, screen } from '@testing-library/react'
import Loader from '../../../../src/components/feedback/Loader.jsx'

describe('components/feedback/Loader', () => {
  test('renders with default accessible semantics and label', () => {
    render(<Loader />)
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  test('uses custom label and inline layout', () => {
    render(<Loader label="Fetching" inline />)
    const status = screen.getByRole('status')
    expect(screen.getByText('Fetching')).toBeInTheDocument()
    expect(status).toHaveStyle({ display: 'inline-flex' })
  })
})
