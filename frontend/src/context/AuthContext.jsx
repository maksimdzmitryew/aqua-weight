import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { apiClient } from '../api/client';
import Loader from '../components/feedback/Loader.jsx';

const AuthContext = createContext(null);

/**
 * AuthProvider
 * Centralizes authentication state, token persistence coordination,
 * and integration with the ApiClient.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'authenticated' | 'unauthenticated'
  const [deviceId, setDeviceId] = useState(() => {
    try {
      let id = localStorage.getItem('aw_device_id');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('aw_device_id', id);
      }
      return id;
    } catch {
      // Fallback for private modes or storage issues
      return crypto.randomUUID();
    }
  });

  // 1. Sync deviceId to state if it was somehow changed elsewhere (unlikely but safe)
  useEffect(() => {
    if (deviceId) {
      try {
        localStorage.setItem('aw_device_id', deviceId);
      } catch (err) {
        console.error('Failed to persist device_id:', err);
      }
    }
  }, [deviceId]);

  // 2. Define auth lifecycle callbacks for the ApiClient.
  const handleUnauthenticated = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    setStatus('unauthenticated');
  }, []);

  const handleAccessTokenUpdated = useCallback((token) => {
    setAccessToken(token);
    setStatus('authenticated');
  }, []);

  // 3. Keep ApiClient in sync with our state/callbacks.
  useEffect(() => {
    apiClient.setAuthHooks({
      getAccessToken: () => accessToken,
      getDeviceId: () => deviceId,
      onAccessTokenUpdated: handleAccessTokenUpdated,
      onUnauthenticated: handleUnauthenticated,
    });
  }, [accessToken, deviceId, handleAccessTokenUpdated, handleUnauthenticated]);

  // 4. Initial authentication check (attempt to re-hydrate session via refresh token).
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        // Attempt one refresh to see if we have a valid session cookie.
        const data = await apiClient.refreshTokens();
        if (mounted && data?.access_token) {
          // Success! handleAccessTokenUpdated will be called via hook,
          // but we set status here as well for immediate feedback.
          setStatus('authenticated');
          // If the backend provided user info in the refresh response, we could set it here.
          if (data.user) setUser(data.user);
        } else if (mounted) {
          setStatus('unauthenticated');
        }
      } catch (err) {
        if (mounted) {
          setStatus('unauthenticated');
        }
      }
    };

    initAuth();
    return () => { mounted = false; };
  }, []);

  // 5. Auth Actions
  const login = useCallback(async (username, password, trustDevice = false) => {
    try {
      const data = await apiClient.post('/auth/login', {
        username,
        password,
        device_id: deviceId,
        trust_device: trustDevice,
      });

      if (data.access_token) {
        setAccessToken(data.access_token);
        if (data.user) setUser(data.user);
        setStatus('authenticated');
      }
      return data;
    } catch (err) {
      throw err;
    }
  }, [deviceId]);

  const logout = useCallback(async () => {
    try {
      // Best effort logout on server; ignore errors to ensure client cleanup.
      if (deviceId) {
        await apiClient.post('/auth/logout', { device_id: deviceId });
      }
    } catch (err) {
      console.warn('Logout request failed:', err);
    } finally {
      handleUnauthenticated();
    }
  }, [deviceId, handleUnauthenticated]);

  const value = useMemo(() => ({
    user,
    accessToken,
    status,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
    deviceId,
    login,
    logout,
  }), [user, accessToken, status, deviceId, login, logout]);

  // Prevent flicker by showing a loader during the initial session check.
  if (status === 'loading') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        width: '100vw',
        background: 'var(--bg, #fff)'
      }}>
        <Loader label="Restoring session..." />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * useAuth
 * Convenient hook for components to access authentication state and actions.
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
