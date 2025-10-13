import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

// Theme can be 'light' | 'dark' | 'system'
const ThemeContext = createContext({
  theme: 'light',
  effectiveTheme: 'light',
  setTheme: (t) => {},
})

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  const [systemTheme, setSystemTheme] = useState(() => getSystemTheme())

  useEffect(() => {
    // Persist theme choice
    try {
      localStorage.setItem('theme', theme)
    } catch {}
  }, [theme])

  useEffect(() => {
    // Listen to system theme changes when in system mode
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setSystemTheme(getSystemTheme())
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else if (mq.addListener) mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else if (mq.removeListener) mq.removeListener(handler)
    }
  }, [])

  const effectiveTheme = theme === 'system' ? systemTheme : theme

  // Optionally reflect theme on document for global styles
  useEffect(() => {
    const el = document.documentElement
    el.setAttribute('data-theme', effectiveTheme)
    return () => {
      el.removeAttribute('data-theme')
    }
  }, [effectiveTheme])

  const value = useMemo(() => ({ theme, effectiveTheme, setTheme }), [theme, effectiveTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
