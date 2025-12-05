import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import Badge from '../../../src/components/Badge.jsx'

// Helper to extract the rendered span element
const getBadgeEl = () => screen.getByRole('status')

describe('Badge.jsx', () => {
  test('renders children, role, and aria-live with default (neutral) tone', () => {
    render(<Badge title="Neutral" >Hello</Badge>)

    const el = getBadgeEl()
    expect(el).toHaveTextContent('Hello')
    expect(el).toHaveAttribute('title', 'Neutral')
    expect(el).toHaveAttribute('aria-live', 'polite')

    // Default tone should be neutral colors
    expect(el).toHaveStyle({
      background: '#f3f4f6',
      color: '#374151',
      border: '1px solid #e5e7eb',
      display: 'inline-flex',
      alignItems: 'center',
      whiteSpace: 'nowrap',
    })
  })

  test('applies success tone styles', () => {
    render(<Badge tone="success">Success</Badge>)
    expect(getBadgeEl()).toHaveStyle({
      background: '#ecfdf5',
      color: '#065f46',
      border: '1px solid #a7f3d0',
    })
  })

  test('applies warning tone styles', () => {
    render(<Badge tone="warning">Warn</Badge>)
    expect(getBadgeEl()).toHaveStyle({
      background: '#fffbeb',
      color: '#92400e',
      border: '1px solid #fde68a',
    })
  })

  test('applies danger tone styles', () => {
    render(<Badge tone="danger">Danger</Badge>)
    expect(getBadgeEl()).toHaveStyle({
      background: '#fef2f2',
      color: '#991b1b',
      border: '1px solid #fecaca',
    })
  })

  test('falls back to neutral when tone is unknown', () => {
    render(<Badge tone={"unknown"}>Fallback</Badge>)
    expect(getBadgeEl()).toHaveStyle({
      background: '#f3f4f6',
      color: '#374151',
      border: '1px solid #e5e7eb',
    })
  })
})
