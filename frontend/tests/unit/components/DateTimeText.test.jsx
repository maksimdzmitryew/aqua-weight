import React from 'react'
import { render, screen } from '@testing-library/react'
import DateTimeText from '../../../src/components/DateTimeText.jsx'

// Helper to set/remove dtFormat preference
function setDtPref(v) {
  if (v == null) localStorage.removeItem('dtFormat')
  else localStorage.setItem('dtFormat', v)
}

describe('DateTimeText', () => {
  afterEach(() => {
    // Clean up user preference between tests
    localStorage.clear()
  })

  it('renders formatted date for valid Date value and respects dtFormat preference (europe default)', () => {
    // europe is the default when key is missing
    const value = new Date(2023, 11, 31, 23, 5) // Dec 31 2023 23:05 local time
    render(<DateTimeText value={value} />)
    const el = screen.getByText((content, node) => node.tagName.toLowerCase() === 'span')
    // Should not render the empty placeholder
    expect(el).toHaveTextContent(/\d/)
    // In europe format we expect 24-hour time (no AM/PM)
    expect(el.textContent).not.toMatch(/AM|PM/i)
  })

  it('renders 12-hour time with AM/PM when dtFormat is set to us', () => {
    setDtPref('us')
    const value = new Date(2023, 11, 31, 23, 5)
    render(<DateTimeText value={value} />)
    const el = screen.getByText(/\d/)
    expect(el.textContent).toMatch(/AM|PM/i)
  })

  it('shows custom empty placeholder when value is null', () => {
    render(<DateTimeText value={null} empty="(none)" />)
    expect(screen.getByText('(none)')).toBeInTheDocument()
  })

  it('treats empty string value as empty and uses default placeholder', () => {
    render(<DateTimeText value="" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('treats value as empty when formatter returns the same string (invalid parse fallback)', () => {
    // If value is a non-date string, formatter returns String(value) => isEmpty true
    const val = 'not-a-date'
    render(<DateTimeText value={val} empty="EMPTY" />)
    // Still uses title derived from value when title prop not provided
    const el = screen.getByText('EMPTY')
    expect(el).toBeInTheDocument()
    expect(el).toHaveAttribute('title', val)
  })

  it('uses provided title attribute when set explicitly', () => {
    render(<DateTimeText value={new Date()} title="explicit" />)
    const el = screen.getByTitle('explicit')
    expect(el).toBeInTheDocument()
  })

  it('omits title attribute when value is falsy and no title provided', () => {
    render(<DateTimeText value={undefined} />)
    const el = screen.getByText('—')
    expect(el).not.toHaveAttribute('title')
  })

  it('respects the "as" prop to render different elements', () => {
    render(<DateTimeText as="div" value={null} />)
    const el = screen.getByText('—')
    expect(el.tagName.toLowerCase()).toBe('div')
  })

  it('passes through className and other props', () => {
    render(<DateTimeText value={null} className="dt" data-testid="dt" />)
    const el = screen.getByTestId('dt')
    expect(el).toHaveClass('dt')
    expect(el).toHaveTextContent('—')
  })
})
