import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from 'react'
import { Toaster, toast } from 'react-hot-toast'
import { apiClient } from '../api/client'
import Loader from '../components/feedback/Loader.jsx'

const AuthContext = createContext(null)

/**
 * Test mode detection: when the backend runs with TEST_MODE=1 and the frontend
 * is served from the test nginx (aw.max), the app auto-authenticates using a
 * localStorage token set by the E2E test login helper.
 */
function isTestMode() {
  try {
    return localStorage.getItem('aw_test_authenticated') === 'true'
  } catch {
    return false
  }
}

function getTestAccessToken() {
  try {
    return localStorage.getItem('aw_test_access_token') || null
  } catch {
    return null
  }
}

/**
 * AuthProvider
 * Centralizes authentication state, token persistence coordination,
 * and integration with the ApiClient.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [accessToken, setAccessToken] = useState(null)
  const [status, setStatus] = useState(isTestMode() ? 'authenticated' : 'loading') // 'loading' | 'authenticated' | 'unauthenticated'

  const accessTokenRef = useRef(accessToken)
  const deviceIdRef = useRef(null)

  const [sessionExpired, setSessionExpired] = useState(false)

  const [deviceId, setDeviceId] = useState(() => {
    try {
      let id = localStorage.getItem('aw_device_id')
      if (!id) {
        id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null
        if (!id) {
          id = Math.random().toString(36).substring(2) + Date.now().toString(36)
        }
        localStorage.setItem('aw_device_id', id)
      }
      return id
    } catch {
      return Math.random().toString(36).substring(2) + Date.now().toString(36)
    }
  })

  useEffect(() => {
    accessTokenRef.current = accessToken
  }, [accessToken])

  useEffect(() => {
    deviceIdRef.current = deviceId
  }, [deviceId])

  // 1. Sync deviceId to state if it was somehow changed elsewhere (unlikely but safe)
  useEffect(() => {
    if (deviceId) {
      try {
        localStorage.setItem('aw_device_id', deviceId)
      } catch (err) {
        console.error('Failed to persist device_id:', err)
      }
    }
  }, [deviceId])

  // 2. Define auth lifecycle callbacks for the ApiClient.
  const handleUnauthenticated = useCallback(() => {
    setSessionExpired(true)
    accessTokenRef.current = null
    setUser(null)
    setAccessToken(null)
    setStatus('unauthenticated')
  }, [])

  const handleAccessTokenUpdated = useCallback((token) => {
    accessTokenRef.current = token
    setAccessToken(token)
    setStatus('authenticated')
  }, [])

  const handleForbidden = useCallback((data) => {
    const msg =
      data?.detail ||
      data?.message ||
      'Access Denied: You do not have permission to perform this action.'
    toast.error(msg, { id: 'forbidden-error' })
  }, [])

  // 3. Keep ApiClient in sync with our state/callbacks.
  useEffect(() => {
    apiClient.setAuthHooks({
      getAccessToken: () => {
        // In test mode, return the test access token from localStorage
        if (isTestMode()) {
          const testToken = getTestAccessToken()
          if (testToken) return testToken
        }
        return accessTokenRef.current
      },
      getDeviceId: () => deviceIdRef.current,
      onAccessTokenUpdated: handleAccessTokenUpdated,
      onUnauthenticated: handleUnauthenticated,
      onForbidden: handleForbidden,
    })
  }, [handleAccessTokenUpdated, handleUnauthenticated, handleForbidden])

  // 4. Initial authentication check (attempt to re-hydrate session via refresh token).
  useEffect(() => {
    let mounted = true

    const initAuth = async () => {
      // In test mode, skip the refresh token call — the localStorage token is sufficient.
      if (isTestMode()) {
        if (mounted) {
          const testToken = getTestAccessToken()
          if (testToken) {
            try {
              const payload = JSON.parse(atob(testToken.split('.')[1]))
              if (payload?.sub) {
                setUser({ id: payload.sub, username: 'test_admin', global_role: 'admin' })
              }
            } catch {
              /* ignore decode errors */
            }
          }
        }
        return
      }

      try {
        // Attempt one refresh to see if we have a valid session cookie.
        const data = await apiClient.refreshTokens()
        if (mounted && data?.access_token) {
          // Success! handleAccessTokenUpdated will be called via hook,
          // but we set status here as well for immediate feedback.
          setStatus('authenticated')
          // If the backend provided user info in the refresh response, we could set it here.
          if (data.user) setUser(data.user)
        } else if (mounted) {
          setStatus('unauthenticated')
        }
      } catch (err) {
        if (mounted) {
          setStatus('unauthenticated')
        }
      }
    }

    initAuth()
    return () => {
      mounted = false
    }
  }, [sessionExpired])

  // 5. Auth Actions
  const login = useCallback(
    async (username, password, trustDevice = false, deviceName = null) => {
      try {
        const data = await apiClient.post('/auth/login', {
          username,
          password,
          device_id: deviceId,
          device_name: deviceName,
          trust_device: trustDevice,
        })

        if (data.access_token) {
          accessTokenRef.current = data.access_token
          setAccessToken(data.access_token)
          if (data.user) setUser(data.user)
          setStatus('authenticated')
        }
        return data
      } catch (err) {
        throw err
      }
    },
    [deviceId],
  )

  const verifyMfa = useCallback(async (mfaToken, code, trustDevice = false, deviceName = null) => {
    try {
      const data = await apiClient.post('/auth/mfa/verify', {
        mfa_token: mfaToken,
        code,
        device_name: deviceName,
        trust_device: trustDevice,
      })

      if (data.access_token) {
        accessTokenRef.current = data.access_token
        setAccessToken(data.access_token)
        if (data.user) setUser(data.user)
        setStatus('authenticated')
      }
      return data
    } catch (err) {
      throw err
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      // Best effort logout on server; ignore errors to ensure client cleanup.
      if (deviceId) {
        await apiClient.post('/auth/logout', { device_id: deviceId })
      }
    } catch (err) {
      console.warn('Logout request failed:', err)
    } finally {
      handleUnauthenticated()
    }
  }, [deviceId, handleUnauthenticated])

  const value = useMemo(
    () => ({
      user,
      accessToken,
      status,
      isAuthenticated: status === 'authenticated',
      isLoading: status === 'loading',
      deviceId,
      login,
      verifyMfa,
      logout,
      sessionExpired,
      setSessionExpired,
    }),
    [user, accessToken, status, deviceId, login, verifyMfa, logout, sessionExpired],
  )

  // Prevent flicker by showing a loader during the initial session check.
  const content =
    status === 'loading' ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          width: '100vw',
          background: 'var(--bg, #fff)',
        }}
      >
        <Loader label="Restoring session..." />
      </div>
    ) : (
      children
    )

  return (
    <AuthContext.Provider value={value}>
      <Toaster position="top-right" toastOptions={{ duration: 5000 }} />
      {content}
    </AuthContext.Provider>
  )
}

/**
 * useAuth
 * Convenient hook for components to access authentication state and actions.
 */
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
