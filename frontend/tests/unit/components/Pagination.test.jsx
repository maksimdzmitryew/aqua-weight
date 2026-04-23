import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Pagination from '../../../src/components/Pagination'

describe('Pagination Component', () => {
  const defaultProps = {
    currentPage: 1,
    totalPages: 10,
    onPageChange: vi.fn(),
    pageSize: 20,
    onPageSizeChange: vi.fn(),
    total: 200,
  }

  it('renders pagination info correctly', () => {
    render(<Pagination {...defaultProps} />)
    expect(screen.getByText(/Showing 1–20 of 200 plants/)).toBeInTheDocument()
  })

  it('renders page numbers correctly', () => {
    render(<Pagination {...defaultProps} />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('marks current page as active', () => {
    render(<Pagination {...defaultProps} currentPage={3} />)
    const page3Button = screen.getByLabelText('Page 3')
    expect(page3Button).toHaveClass('active')
  })

  it('calls onPageChange when page button is clicked', () => {
    const onPageChange = vi.fn()
    render(<Pagination {...defaultProps} onPageChange={onPageChange} />)

    const page2Button = screen.getByLabelText('Page 2')
    fireEvent.click(page2Button)

    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('disables previous button on first page', () => {
    render(<Pagination {...defaultProps} currentPage={1} />)
    const prevButton = screen.getByLabelText('Previous page')
    expect(prevButton).toBeDisabled()
  })

  it('disables next button on last page', () => {
    render(<Pagination {...defaultProps} currentPage={10} />)
    const nextButton = screen.getByLabelText('Next page')
    expect(nextButton).toBeDisabled()
  })

  it('calls onPageChange when previous button is clicked', () => {
    const onPageChange = vi.fn()
    render(<Pagination {...defaultProps} currentPage={5} onPageChange={onPageChange} />)

    const prevButton = screen.getByLabelText('Previous page')
    fireEvent.click(prevButton)

    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  it('calls onPageChange when next button is clicked', () => {
    const onPageChange = vi.fn()
    render(<Pagination {...defaultProps} currentPage={5} onPageChange={onPageChange} />)

    const nextButton = screen.getByLabelText('Next page')
    fireEvent.click(nextButton)

    expect(onPageChange).toHaveBeenCalledWith(6)
  })

  it('renders ellipsis for large page counts', () => {
    render(<Pagination {...defaultProps} currentPage={5} totalPages={20} />)
    const ellipses = screen.getAllByText('...')
    expect(ellipses.length).toBeGreaterThan(0)
  })

  it('shows all pages when total pages <= 7', () => {
    render(<Pagination {...defaultProps} totalPages={5} />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders page size selector with correct options', () => {
    render(<Pagination {...defaultProps} />)
    const select = screen.getByLabelText('Per page:')
    expect(select).toBeInTheDocument()

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(4) // 10, 20, 50, 100
  })

  it('calls onPageSizeChange when page size is changed', () => {
    const onPageSizeChange = vi.fn()
    render(<Pagination {...defaultProps} onPageSizeChange={onPageSizeChange} />)

    const select = screen.getByLabelText('Per page:')
    fireEvent.change(select, { target: { value: '50' } })

    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it('disables all controls when disabled prop is true', () => {
    render(<Pagination {...defaultProps} disabled={true} />)

    const prevButton = screen.getByLabelText('Previous page')
    const nextButton = screen.getByLabelText('Next page')
    const select = screen.getByLabelText('Per page:')

    expect(prevButton).toBeDisabled()
    expect(nextButton).toBeDisabled()
    expect(select).toBeDisabled()
  })

  it('handles zero total correctly', () => {
    render(<Pagination {...defaultProps} total={0} totalPages={0} />)
    expect(screen.getByText(/Showing 0–0 of 0 plants/)).toBeInTheDocument()
  })

  it('handles single plant correctly', () => {
    render(<Pagination {...defaultProps} total={1} totalPages={1} pageSize={20} />)
    expect(screen.getByText(/Showing 1–1 of 1 plant/)).toBeInTheDocument()
  })

  it('calculates correct item range for middle pages', () => {
    render(<Pagination {...defaultProps} currentPage={5} pageSize={20} total={200} />)
    expect(screen.getByText(/Showing 81–100 of 200 plants/)).toBeInTheDocument()
  })

  it('shows ellipsis at start when near end', () => {
    render(<Pagination {...defaultProps} currentPage={19} totalPages={20} />)
    const ellipses = screen.getAllByText('...')
    expect(ellipses.length).toBe(1)
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Page 20')).toBeInTheDocument()
  })

  it('shows ellipsis at end when near start', () => {
    render(<Pagination {...defaultProps} currentPage={2} totalPages={20} />)
    const ellipses = screen.getAllByText('...')
    expect(ellipses.length).toBe(1)
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Page 20')).toBeInTheDocument()
  })

  it('shows ellipsis on both sides when in middle', () => {
    render(<Pagination {...defaultProps} currentPage={10} totalPages={20} />)
    const ellipses = screen.getAllByText('...')
    expect(ellipses.length).toBe(2)
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Page 20')).toBeInTheDocument()
  })
})
