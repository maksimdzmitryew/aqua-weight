import React from 'react'
import { render, screen } from '@testing-library/react'
import { server } from './msw/server'
import { http, HttpResponse } from 'msw'
import App from '../../src/App.jsx'

describe('App.jsx', () => {
  test('shows loading, then renders backend message on success', async () => {
    // Arrange mock for /api/ root endpoint
    server.use(
      http.get('/api/', () => HttpResponse.json({ message: 'Hello from test' }))
    )

    render(<App />)

    // Initial state shows loading
    expect(screen.getByText(/loading/i)).toBeInTheDocument()

    // After fetch resolves, message appears
    expect(await screen.findByText(/backend says: hello from test/i)).toBeInTheDocument()

    // Static content renders as well (smoke check)
    expect(screen.getByRole('heading', { name: /aw frontend/i })).toBeInTheDocument()
  })

  test('shows fallback message when backend request fails', async () => {
    // Make the request reject to hit catch() branch
    server.use(
      http.get('/api/', () => HttpResponse.error())
    )

    render(<App />)

    // Loading first
    expect(screen.getByText(/loading/i)).toBeInTheDocument()

    // Then failure message
    expect(await screen.findByText(/failed to reach backend/i)).toBeInTheDocument()
  })
})
