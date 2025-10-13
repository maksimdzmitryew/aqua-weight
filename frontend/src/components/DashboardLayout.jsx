import React from 'react'
import { Link, useLocation } from 'react-router-dom'

export default function DashboardLayout({ title = 'Dashboard', children }) {
  const location = useLocation()
  const menuItems = [
    { key: 'overview', label: 'Overview', to: '/dashboard' },
    { key: 'plants', label: 'Plants', to: '/plants' },
    { key: 'locations', label: 'Locations', to: '/locations' },
    { key: 'settings', label: 'Settings', to: '/settings' },
    // Future items can be added here
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 240,
          background: '#0f172a',
          color: 'white',
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
                  color: 'inherit',
                  textDecoration: 'none',
                  padding: '10px 8px',
                  borderRadius: 6,
                  marginBottom: 6,
                  background: active ? '#1f2937' : '#111827',
                }}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div style={{ marginTop: 16 }}>
          <Link to="/" style={{ color: '#93c5fd' }}>
            ← Back to Home
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: 24 }}>{children}</main>
    </div>
  )
}
