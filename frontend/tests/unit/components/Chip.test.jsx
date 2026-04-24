import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import Chip from '../../../src/components/Chip.jsx'

const getChip = () => screen.getByRole('button')

describe('Chip.jsx', () => {
  test('renders label text', () => {
    render(<Chip label="Water" />)
    expect(getChip()).toHaveTextContent('Water')
  })

  test('has aria-pressed reflecting selected state', () => {
    const { rerender } = render(<Chip label="A" selected={false} />)
    expect(getChip()).toHaveAttribute('aria-pressed', 'false')

    rerender(<Chip label="A" selected={true} />)
    expect(getChip()).toHaveAttribute('aria-pressed', 'true')
  })

  test('applies pointer cursor and full opacity when not disabled (lines 15, 18)', () => {
    render(<Chip label="A" disabled={false} />)
    expect(getChip()).toHaveStyle({ cursor: 'pointer', opacity: 1 })
  })

  test('applies not-allowed cursor and reduced opacity when disabled (lines 15, 18)', () => {
    render(<Chip label="A" disabled={true} />)
    expect(getChip()).toHaveStyle({ cursor: 'not-allowed', opacity: 0.5 })
  })

  test('calls onClick when enabled (line 31)', () => {
    const onClick = vi.fn()
    render(<Chip label="A" onClick={onClick} />)
    fireEvent.click(getChip())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('does not call onClick when disabled (line 31)', () => {
    const onClick = vi.fn()
    render(<Chip label="A" onClick={onClick} disabled={true} />)
    fireEvent.click(getChip())
    expect(onClick).not.toHaveBeenCalled()
  })

  test('applies selected styles when selected', () => {
    render(<Chip label="A" selected={true} />)
    expect(getChip()).toHaveStyle({
      background: '#111827',
      color: '#ffffff',
      borderColor: '#111827',
    })
  })

  test('applies unselected styles when not selected', () => {
    render(<Chip label="A" selected={false} />)
    expect(getChip()).toHaveStyle({
      background: 'transparent',
      color: '#374151',
      borderColor: '#d1d5db',
    })
  })
})
