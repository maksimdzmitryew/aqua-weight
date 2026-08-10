import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { AuthProvider, useAuth } from '../../../../src/context/AuthContext'
import { apiClient } from '../../../../src/api/client'

// Mock matchMedia for react-hot-toast
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock apiClient
vi.mock('../../../../src/api/client', () => ({
  apiClient: {
    setAuthHooks: vi.fn(),
    refreshTokens: vi.fn(),
    post: vi.fn(),
  },
}))

// Mock Loader component
vi.mock('../../../../src/components/feedback/Loader.jsx', () => ({
  default: ({ label }) => <div data-testid="loader">{label}</div>,
}))

// Helper to create a test component that uses auth
const AuthTestComponent = () => {
  const { user, status, login, logout, isAuthenticated, deviceId } = useAuth()
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'not authenticated'}</div>
      <div data-testid="username">{user?.username || 'no user'}</div>
      <div data-testid="device-id">{deviceId}</div>
      <button onClick={() => login('testuser', 'password')}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  )
}

describe('Logout Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('successfully logs out user and calls the logout API', async () => {
    // Set up authenticated state
    apiClient.refreshTokens.mockResolvedValue({
      access_token: 'token',
      user: { username: 'user' },
    })

    // Mock logout to return a promise that resolves
    apiClient.post.mockResolvedValue({ success: true })

    render(
      <AuthProvider>
        <AuthTestComponent />
      </AuthProvider>,
    )

    // Wait for initial authentication to complete
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    })

    // Perform logout
    await act(async () => {
      screen.getByText('Logout').click()
    })

    // Verify the logout API was called with the correct endpoint and device_id
    expect(apiClient.post).toHaveBeenCalledWith('/auth/logout', {
      device_id: expect.any(String),
    })
  })

  it('handles logout when already unauthenticated', async () => {
    // Start with unauthenticated state
    apiClient.refreshTokens.mockRejectedValue(new Error('no session'))

    render(
      <AuthProvider>
        <AuthTestComponent />
      </AuthProvider>,
    )

    // Wait for auth to be unauthenticated
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    })

    // When unauthenticated, logout should not make API calls
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('calls logout API with device_id when device is available', async () => {
    // Set up authenticated state
    apiClient.refreshTokens.mockResolvedValue({
      access_token: 'token',
      user: { username: 'user' },
    })

    apiClient.post.mockResolvedValue({ success: true })

    render(
      <AuthProvider>
        <AuthTestComponent />
      </AuthProvider>,
    )

    // Wait for authentication
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    })

    // Perform logout
    await act(async () => {
      screen.getByText('Logout').click()
    })

    // Verify logout was called with device_id
    expect(apiClient.post).toHaveBeenCalledWith('/auth/logout', {
      device_id: expect.any(String),
    })
  })
})
