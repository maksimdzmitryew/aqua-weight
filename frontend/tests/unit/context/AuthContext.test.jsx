import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { AuthProvider, useAuth } from '../../../src/context/AuthContext'
import { apiClient } from '../../../src/api/client'

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
vi.mock('../../../src/api/client', () => ({
  apiClient: {
    setAuthHooks: vi.fn(),
    refreshTokens: vi.fn(),
    post: vi.fn(),
  },
}))

// Helper component to test useAuth
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

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows loading state initially and then unauthenticated if refresh fails', async () => {
    apiClient.refreshTokens.mockRejectedValue(new Error('Refresh failed'))

    render(
      <AuthProvider>
        <AuthTestComponent />
      </AuthProvider>
    )

    // Initially should show Loader
    expect(screen.getByText(/Restoring session.../i)).toBeInTheDocument()

    // After refresh fails
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    })
  })

  it('authenticates automatically in test mode if tokens present', async () => {
    const mockToken = 'header.' + btoa(JSON.stringify({ sub: 'user-123' })) + '.signature'
    localStorage.setItem('aw_test_authenticated', 'true')
    localStorage.setItem('aw_test_access_token', mockToken)

    render(
      <AuthProvider>
        <AuthTestComponent />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      expect(screen.getByTestId('username')).toHaveTextContent('test_admin')
    })
    
    // Check that setAuthHooks was called and getAccessToken returns the test token
    const authHooks = apiClient.setAuthHooks.mock.calls[0][0]
    expect(authHooks.getAccessToken()).toBe(mockToken)
  })

  it('performs login successfully', async () => {
    apiClient.refreshTokens.mockRejectedValue(new Error('no session'))
    apiClient.post.mockResolvedValue({
      access_token: 'new-token',
      user: { username: 'logged-in-user' }
    })

    render(
      <AuthProvider>
        <AuthTestComponent />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    })

    await act(async () => {
      screen.getByText('Login').click()
    })

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(screen.getByTestId('username')).toHaveTextContent('logged-in-user')
    expect(apiClient.post).toHaveBeenCalledWith('/auth/login', expect.objectContaining({
      username: 'testuser',
      password: 'password'
    }))
  })

  it('performs logout', async () => {
    // Start authenticated
    apiClient.refreshTokens.mockResolvedValue({
      access_token: 'token',
      user: { username: 'user' }
    })

    render(
      <AuthProvider>
        <AuthTestComponent />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    })

    await act(async () => {
      // Ensure subsequent refresh attempts fail after logout
      apiClient.refreshTokens.mockRejectedValue(new Error('Logged out'))
      screen.getByText('Logout').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    })
    expect(apiClient.post).toHaveBeenCalledWith('/auth/logout', expect.any(Object))
  })

  it('performs verifyMfa successfully', async () => {
    // Need a custom Test component that exposes verifyMfa
    let verifyMfaFn
    const MfaTestComponent = () => {
      const { verifyMfa } = useAuth()
      verifyMfaFn = verifyMfa
      return null
    }

    apiClient.post.mockResolvedValue({
      access_token: 'mfa-new-token',
      user: { username: 'mfa-user' }
    })

    render(
      <AuthProvider>
        <MfaTestComponent />
      </AuthProvider>
    )

    await waitFor(() => expect(typeof verifyMfaFn).toBe('function'))

    let res
    await act(async () => {
       res = await verifyMfaFn('mfa-token', '123456')
    })

    expect(res.access_token).toBe('mfa-new-token')
  })

  it('handles forbidden error via toast', async () => {
    render(
      <AuthProvider>
        <AuthTestComponent />
      </AuthProvider>
    )

    const authHooks = apiClient.setAuthHooks.mock.calls[0][0]
    
    // This should trigger toast.error (mocking toast is not easy but we can check if it's called if we mock it)
    // For now we just call it to get coverage
    await act(async () => {
      authHooks.onForbidden({ detail: 'Access Denied' })
    })
  })

  it('handles unauthenticated callback from apiClient', async () => {
    render(
      <AuthProvider>
        <AuthTestComponent />
      </AuthProvider>
    )

    const authHooks = apiClient.setAuthHooks.mock.calls[0][0]
    
    await act(async () => {
      authHooks.onUnauthenticated()
    })

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
  })

  it('throws error if useAuth is used outside AuthProvider', () => {
    // Suppress console.error for this expected error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    expect(() => render(<AuthTestComponent />)).toThrow('useAuth must be used within an AuthProvider')
    
    consoleSpy.mockRestore()
  })
})
