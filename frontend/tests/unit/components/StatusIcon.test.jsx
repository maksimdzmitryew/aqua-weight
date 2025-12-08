import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import StatusIcon from '../../../src/components/StatusIcon.jsx'

function Wrapper({ children }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

describe('StatusIcon', () => {
  test('computes title/aria-label based on type and active; defaults when no label provided', () => {
    render(
      <Wrapper>
        <>
          <StatusIcon type="water" active={true} />
          <StatusIcon type="water" active={false} />
          <StatusIcon type="measure" active={true} />
          <StatusIcon type="measure" active={false} />
        </>
      </Wrapper>
    )

    expect(screen.getByRole('img', { name: 'Needs watering' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'No watering needed' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Needs measurement' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'No measurement needed' })).toBeInTheDocument()
  })

  test('uses provided label instead of default title', () => {
    render(
      <Wrapper>
        <StatusIcon type="water" active={true} label="Custom" />
      </Wrapper>
    )
    const el = screen.getByRole('img', { name: 'Custom' })
    expect(el).toBeInTheDocument()
  })

  test('applies light theme styles for active/inactive and border color', () => {
    // ensure light theme default
    window.localStorage.setItem('theme', 'light')

    const { rerender } = render(
      <Wrapper>
        <StatusIcon type="water" active={true} />
      </Wrapper>
    )
    let el = screen.getByRole('img', { name: 'Needs watering' })
    // active water uses strong blue background, light border
    expect(el).toHaveStyle({ background: '#1d4ed8', color: '#ffffff', border: '1px solid #cbd5e1' })

    rerender(
      <Wrapper>
        <StatusIcon type="measure" active={true} />
      </Wrapper>
    )
    el = screen.getByRole('img', { name: 'Needs measurement' })
    // active measure uses green background
    expect(el).toHaveStyle({ background: '#16a34a', color: '#ffffff', border: '1px solid #cbd5e1' })

    rerender(
      <Wrapper>
        <StatusIcon type="measure" active={false} />
      </Wrapper>
    )
    el = screen.getByRole('img', { name: 'No measurement needed' })
    // inactive uses light gray background and darker foreground text
    expect(el).toHaveStyle({ background: '#e5e7eb', color: '#374151', border: '1px solid #cbd5e1' })
  })

  test('applies dark theme styles for active/inactive, including border and inset shadow', () => {
    window.localStorage.setItem('theme', 'dark')

    const { rerender } = render(
      <Wrapper>
        <StatusIcon type="water" active={true} />
      </Wrapper>
    )
    let el = screen.getByRole('img', { name: 'Needs watering' })
    // in dark mode for water active: blue background (same), white text, dark border, inset shadow
    expect(el).toHaveStyle({ background: '#1d4ed8', color: '#ffffff', border: '1px solid #111827', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)' })

    rerender(
      <Wrapper>
        <StatusIcon type="measure" active={true} />
      </Wrapper>
    )
    el = screen.getByRole('img', { name: 'Needs measurement' })
    expect(el).toHaveStyle({ background: '#16a34a', color: '#ffffff', border: '1px solid #111827', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)' })

    rerender(
      <Wrapper>
        <StatusIcon type="measure" active={false} />
      </Wrapper>
    )
    el = screen.getByRole('img', { name: 'No measurement needed' })
    expect(el).toHaveStyle({ background: '#374151', color: '#9ca3af', border: '1px solid #111827', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)' })

    // cleanup
    window.localStorage.removeItem('theme')
  })
})
