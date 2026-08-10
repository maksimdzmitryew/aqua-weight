import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { SettingsProvider, useSettings } from '../../../src/context/SettingsContext'
import { apiClient } from '../../../src/api/client'
import { useAuth } from '../../../src/context/AuthContext'
import { useTheme } from '../../../src/ThemeContext'

// Mock dependencies
vi.mock('../../../src/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

vi.mock('../../../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../../src/ThemeContext', () => ({
  useTheme: vi.fn(),
}))

// Helper component
const SettingsTestComponent = () => {
  const { settings, loading, error, updateSettings, refreshSettings } = useSettings()
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'idle'}</div>
      <div data-testid="error">{error || 'no error'}</div>
      <div data-testid="theme">{settings.theme || 'no theme'}</div>
      <button onClick={() => updateSettings({ theme: 'dark' })}>Update Theme</button>
      <button onClick={refreshSettings}>Refresh</button>
    </div>
  )
}

describe('SettingsContext', () => {
  const mockSetTheme = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useTheme.mockReturnValue({ setTheme: mockSetTheme })
  })

  it('fetches settings when authenticated', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true })
    apiClient.get.mockResolvedValue({
      settings: { theme: 'light', displayName: 'User' },
      version: 1,
    })

    render(
      <SettingsProvider>
        <SettingsTestComponent />
      </SettingsProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('theme')).toHaveTextContent('light')
    })

    expect(mockSetTheme).toHaveBeenCalledWith('light')
    expect(localStorage.getItem('theme')).toBe('light')
    expect(localStorage.getItem('displayName')).toBe('User')
  })

  it('does not fetch settings when not authenticated', async () => {
    useAuth.mockReturnValue({ isAuthenticated: false })

    render(
      <SettingsProvider>
        <SettingsTestComponent />
      </SettingsProvider>,
    )

    expect(apiClient.get).not.toHaveBeenCalled()
    expect(screen.getByTestId('theme')).toHaveTextContent('no theme')
  })

  it('handles fetch error', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true })
    apiClient.get.mockRejectedValue({ detail: 'Fetch failed' })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <SettingsProvider>
        <SettingsTestComponent />
      </SettingsProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Fetch failed')
    })

    consoleErrorSpy.mockRestore()
  })

  it('updates settings successfully', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true })
    apiClient.get.mockResolvedValue({ settings: { theme: 'light' }, version: 1 })
    apiClient.put.mockResolvedValue({ ok: true })

    render(
      <SettingsProvider>
        <SettingsTestComponent />
      </SettingsProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('theme')).toHaveTextContent('light')
    })

    await act(async () => {
      screen.getByText('Update Theme').click()
    })

    expect(apiClient.put).toHaveBeenCalledWith(
      '/settings',
      expect.objectContaining({
        settings: expect.objectContaining({ theme: 'dark' }),
      }),
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('throws error if useSettings is used outside Provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<SettingsTestComponent />)).toThrow(
      'useSettings must be used within a SettingsProvider',
    )
    consoleSpy.mockRestore()
  })
})
