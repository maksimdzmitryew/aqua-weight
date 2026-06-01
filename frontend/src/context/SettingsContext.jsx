import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { apiClient } from '../api/client'
import { useAuth } from './AuthContext'
import { useTheme } from '../ThemeContext'

const SettingsContext = createContext()

export const SettingsProvider = ({ children }) => {
  const { isAuthenticated } = useAuth()
  const { setTheme } = useTheme()
  const [settings, setSettings] = useState({})
  const [version, setVersion] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchSettings = useCallback(async () => {
    if (!isAuthenticated) {
      setSettings({})
      setVersion(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await apiClient.get('/settings')
      const fetchedSettings = data.settings || {}
      setSettings(fetchedSettings)
      setVersion(data.version)
      
      if (fetchedSettings.theme) {
        setTheme(fetchedSettings.theme)
      }
      
      // Update localStorage as a shim for components not yet converted to useSettings
      const keys = ['displayName', 'dtFormat', 'operationMode', 'defaultThreshold', 'pageSize', 'theme']
      keys.forEach(key => {
        if (fetchedSettings[key] !== undefined) {
          localStorage.setItem(key, fetchedSettings[key])
        }
      })
    } catch (err) {
      console.error('Failed to fetch settings:', err)
      setError(err.detail || 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, setTheme])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const updateSettings = useCallback(async (newSettings) => {
    try {
      const updated = { ...settings, ...newSettings }
      await apiClient.put('/settings', { settings: updated, version })
      setSettings(updated)
      
      if (newSettings.theme) {
        setTheme(newSettings.theme)
      }
      
      // Update localStorage shim
      Object.entries(newSettings).forEach(([key, value]) => {
        localStorage.setItem(key, value)
      })
    } catch (err) {
      console.error('Failed to update settings:', err)
      throw err
    }
  }, [settings, version, setTheme])

  return (
    <SettingsContext.Provider value={{ settings, loading, error, updateSettings, refreshSettings: fetchSettings, version }}>
      {children}
    </SettingsContext.Provider>
  )
}

export const useSettings = () => {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
