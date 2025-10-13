import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '../ThemeContext.jsx'

export default function DashboardLayout({ title = 'Dashboard', children }) {
  const location = useLocation()
  const { effectiveTheme } = useTheme()

  const isDark = effectiveTheme === 'dark'
  const colors = {
    sidebarBg: isDark ? '#0f172a' : '#f3f4f6',
    sidebarText: isDark ? 'white' : '#111827',
    linkBg: isDark ? '#111827' : '#e5e7eb',
    linkBgActive: isDark ? '#1f2937' : '#d1d5db',
    linkText: isDark ? 'inherit' : '#111827',
    backLink: isDark ? '#93c5fd' : '#1d4ed8',
    mainBg: isDark ? '#0b1220' : '#ffffff',
    mainText: isDark ? '#e5e7eb' : '#111827',
  }

  const menuItems = [
    { key: 'overview', label: 'Overview', to: '/dashboard' },
    { key: 'plants', label: 'Plants', to: '/plants' },
    { key: 'locations', label: 'Locations', to: '/locations' },
    { key: 'settings', label: 'Settings', to: '/settings' },
    // Future items can be added here
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'sans-serif', background: colors.mainBg, color: colors.mainText }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 240,
          background: colors.sidebarBg,
          color: colors.sidebarText,
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{title}</div>
        <nav>
          {menuItems.map((item) => {
            const active = location.pathname === item.to
            return (
              <Link
                key={item.key}
                to={item.to}
                style={{
                  display: 'block',
                  color: colors.linkText,
                  textDecoration: 'none',
                  padding: '10px 8px',
                  borderRadius: 6,
                  marginBottom: 6,
                  background: active ? colors.linkBgActive : colors.linkBg,
                }}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div style={{ marginTop: 16 }}>
          <Link to="/" style={{ color: colors.backLink }}>
            ← Back to Home
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: 24, background: colors.mainBg, color: colors.mainText }}>{children}</main>
    </div>
  )
}
