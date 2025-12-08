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

    expect(screen.getByRole('heading', { name: /welcome to the dashboard/i })).toBeInTheDocument()
    expect(screen.getByText(/simple dashboard layout/i)).toBeInTheDocument()
  })
})
