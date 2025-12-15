import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '../../../src/pages/Dashboard.jsx'

describe('pages/Dashboard', () => {
  test('renders dashboard layout and welcome text', () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ThemeProvider>
    )

    // Updated expectations to match current UI content
    expect(screen.getByRole('heading', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByText(/each plant is represented by its weight trend/i)).toBeInTheDocument()
  })
})
