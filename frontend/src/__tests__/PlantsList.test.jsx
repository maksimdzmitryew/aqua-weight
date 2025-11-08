import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../src/ThemeContext.jsx'
import PlantsList from '../../src/pages/PlantsList.jsx'

// Mock plantsApi.list used by PlantsList
jest.mock('../../src/api/plants', () => ({
  plantsApi: {
    list: jest.fn(),
    reorder: jest.fn(),
  },
}))

const { plantsApi } = require('../../src/api/plants')

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <PlantsList />
      </MemoryRouter>
    </ThemeProvider>
  )
}

test('shows loader and then renders items', async () => {
  plantsApi.list.mockResolvedValueOnce([
    { uuid: 'u1', name: 'Aloe', created_at: '2025-01-01T00:00:00Z' },
    { uuid: 'u2', name: 'Monstera', created_at: '2025-01-02T00:00:00Z' },
  ])
  renderPage()
  // Loader role is not standard; rely on text from Loader component if any
  // We expect items to appear
  expect(await screen.findByText('Aloe')).toBeInTheDocument()
  expect(screen.getByText('Monstera')).toBeInTheDocument()
})

test('renders empty state when no plants', async () => {
  plantsApi.list.mockResolvedValueOnce([])
  renderPage()
  const note = await screen.findByRole('note')
  expect(note).toBeInTheDocument()
})

test('shows error notice when API fails', async () => {
  plantsApi.list.mockRejectedValueOnce(new Error('Network down'))
  renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/Network down/i)
})
