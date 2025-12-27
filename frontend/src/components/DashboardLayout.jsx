import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import useDocumentTitle from '../hooks/useDocumentTitle.js'

export default function DashboardLayout({ title = 'Dashboard', children }) {
  const location = useLocation()
  const operationMode = typeof localStorage !== 'undefined' ? localStorage.getItem('operationMode') : 'manual'

  // Keep browser tab title in sync for all dashboard pages
  useDocumentTitle(title)

  const menuItems = [
    { key: 'overview', label: 'Overview', to: '/dashboard' },
    { key: 'daily', label: 'Daily Care', to: '/daily' },
    { key: 'plants', label: 'Plants', to: '/plants' },
    { key: 'calibration', label: 'Calibration', to: '/calibration' },
    { key: 'locations', label: 'Locations', to: '/locations' },
    { key: 'settings', label: 'Settings', to: '/settings' },
  ]

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-title">{title}</div>
        <nav>
          {menuItems.map((item) => {
            const active = location.pathname === item.to
            return (
              <Link
                key={item.key}
                to={item.to}
                className={`nav-link${active ? ' active' : ''}`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-4">
          <Link to="/" className="back-link">
            ← Back to Home
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="main">
        {operationMode === 'vacation' && (
          <div role="status" style={noticeStyle}>
            Vacation mode — watering by approximated historical schedule
          </div>
        )}
        {operationMode === 'manual' && (
          <div role="status" style={noticeStyle}>
            Manual mode — weighing and watering is based on human input
          </div>
        )}
        {children}
      </main>
    </div>
  )
}

const noticeStyle = {
  padding: '12px',
  marginBottom: '16px',
  borderRadius: '6px',
  background: '#e0f2fe',
  color: '#0369a1',
  border: '1px solid #bae6fd',
  fontWeight: 500
}
