import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import PlantSelect from '../../../src/components/PlantSelect.jsx'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { http, HttpResponse } from 'msw'
import { server } from '../msw/server'
import { useForm } from '../../../src/components/form/useForm.js'

const TestWrapper = ({ children }) => {
  const form = useForm({ initialValues: { plant_id: '' } })
  return <ThemeProvider>{React.cloneElement(children, { form })}</ThemeProvider>
}

describe('components/PlantSelect', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/plants/names', () => {
        return HttpResponse.json([
          { uuid: 'p1', name: 'Plant 1' },
          { uuid: 'p2', name: 'Plant 2' },
        ])
      }),
    )
  })

  test('loads and displays plant names', async () => {
    render(
      <TestWrapper>
        <PlantSelect name="plant_id" label="Plant" />
      </TestWrapper>,
    )

    // Initial loading state in option
    expect(screen.getByText(/loading plants/i)).toBeInTheDocument()

    // Loaded state
    await waitFor(() => expect(screen.queryByText(/loading plants/i)).not.toBeInTheDocument())
    expect(await screen.findByText('Plant 1')).toBeInTheDocument()
    expect(await screen.findByText('Plant 2')).toBeInTheDocument()
  })

  test('handles API error (Branch coverage for Line 34)', async () => {
    server.use(
      http.get('/api/plants/names', () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )

    render(
      <TestWrapper>
        <PlantSelect name="plant_id" label="Plant" />
      </TestWrapper>,
    )

    await waitFor(() => expect(screen.getByText(/failed to load plants/i)).toBeInTheDocument())
    // Select should have error text in default option too
    expect(screen.getByText(/error loading plants/i)).toBeInTheDocument()
  })

  test('ignores AbortError (Branch coverage for Line 35)', async () => {
    server.use(
      http.get('/api/plants/names', () => {
        return HttpResponse.error() // Or a way to simulate abort
      }),
    )

    // We can't easily trigger AbortError from MSW that reaches the catch without being an actual error
    // but we can mock the plantsApi.listNames to throw an AbortError
    const { plantsApi } = await import('../../../src/api/plants')
    const originalListNames = plantsApi.listNames

    const abortError = new Error('Abort')
    abortError.name = 'AbortError'
    plantsApi.listNames = vi.fn().mockRejectedValueOnce(abortError)

    try {
      render(
        <TestWrapper>
          <PlantSelect name="plant_id" label="Plant" />
        </TestWrapper>,
      )

      // It should NOT set error state
      await waitFor(() => expect(screen.queryByText(/loading plants/i)).not.toBeInTheDocument())
      expect(screen.queryByText(/failed to load plants/i)).not.toBeInTheDocument()
    } finally {
      plantsApi.listNames = originalListNames
    }
  })

  test('handles non-array response gracefully (Line 32)', async () => {
    server.use(
      http.get('/api/plants/names', () => {
        return HttpResponse.json({ not_an_array: true })
      }),
    )

    render(
      <TestWrapper>
        <PlantSelect name="plant_id" label="Plant" />
      </TestWrapper>,
    )

    await waitFor(() => expect(screen.queryByText(/loading plants/i)).not.toBeInTheDocument())
    // No options should be rendered besides the default one
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toBe('Select plant...')
  })

  test('error with empty message uses fallback branch on line 34', async () => {
    const { plantsApi } = await import('../../../src/api/plants')
    const originalListNames = plantsApi.listNames

    // Reject with an error that has an empty message to take the falsy branch of (e?.message || '')
    plantsApi.listNames = vi.fn().mockRejectedValueOnce(new Error(''))

    try {
      render(
        <TestWrapper>
          <PlantSelect name="plant_id" label="Plant" />
        </TestWrapper>,
      )

      await waitFor(() => expect(screen.getByText(/failed to load plants/i)).toBeInTheDocument())
      // Default option text switches to error variant
      expect(screen.getByText(/error loading plants/i)).toBeInTheDocument()
    } finally {
      plantsApi.listNames = originalListNames
    }
  })
})
