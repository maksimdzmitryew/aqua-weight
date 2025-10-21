import React from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'

export default function Dashboard() {
  return (
    <DashboardLayout title="Dashboard">
      <h1 style={{ marginTop: 0 }}>Welcome to the Dashboard</h1>
      <p>This is a simple dashboard layout with a left-side menu.</p>
      <p>
        You can add nested routes and actual content sections later. The menu is now
        reusable across pages and includes navigation to the Plants list.
      </p>
    </DashboardLayout>
  )
}
