import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import App from './App.jsx'
import Dashboard from './pages/Dashboard.jsx'
import PlantsList from './pages/PlantsList.jsx'
import LocationsList from './pages/LocationsList.jsx'
import Settings from './pages/Settings.jsx'
import Devices from './pages/Devices.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { SettingsProvider } from './context/SettingsContext.jsx'
import Login from './pages/Login.jsx'
import InviteComplete from './pages/InviteComplete.jsx'
import ProtectedRoute from './components/auth/ProtectedRoute.jsx'
import Loader from './components/feedback/Loader.jsx'
import PlantEdit from './pages/PlantEdit.jsx'
import LocationEdit from './pages/LocationEdit.jsx'
import PlantCreate from './pages/PlantCreate.jsx'
import LocationCreate from './pages/LocationCreate.jsx'
import MeasurementCreate from './pages/MeasurementCreate.jsx'
import WateringCreate from './pages/WateringCreate.jsx'
import RepottingCreate from './pages/RepottingCreate.jsx'
import PlantDetails from './pages/PlantDetails.jsx'
import PlantStats from './pages/PlantStats.jsx'
import DailyCare from './pages/DailyCare.jsx'
import BulkWeightMeasurement from './pages/BulkWeightMeasurement.jsx'
import BulkWatering from './pages/BulkWatering.jsx'
import Calibration from './pages/Calibration.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import MFASetup from './pages/MFASetup.jsx'
import { Navigate, Outlet } from 'react-router-dom'
import './styles/theme.css'

const Logout = () => {
  const { logout } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    logout().finally(() => navigate('/login'))
  }, [logout, navigate])
  return (
    <div
      className="layout"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
      }}
    >
      <Loader label="Logging out..." />
    </div>
  )
}

/**
 * SessionManager component
 *
 * Provides a central listener for authentication state changes.
 * If the user becomes unauthenticated while on a restricted page,
 * they are redirected to the login page.
 */
const SessionManager = () => {
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const path = location.pathname.replace(/\/$/, '') || '/'
    if (status === 'unauthenticated') {
      const publicPaths = ['/', '/login', '/logout', '/invite/complete']
      const isPublic = publicPaths.includes(path) || path.startsWith('/invite/')
      if (!isPublic) {
        navigate('/login', { state: { from: location }, replace: true })
      }
    } else if (status === 'authenticated' && path === '/login') {
      const from = location.state?.from?.pathname || '/dashboard'
      navigate(from, { replace: true })
    }
  }, [status, navigate, location])

  return null
}

const RequireAdmin = ({ children }) => {
  const { user, isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (user?.global_role !== 'admin') {
    return (
      <div
        className="layout"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <h1>403: Forbidden</h1>
        <p>You do not have permission to access this page.</p>
        <a href="/dashboard" className="nav-link" style={{ marginTop: 16 }}>
          Go to Dashboard
        </a>
      </div>
    )
  }

  return children ? children : <Outlet />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <SettingsProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <SessionManager />
            <Routes>
              <Route path="/" element={<App />} />
              <Route path="/login" element={<Login />} />
              <Route path="/logout" element={<Logout />} />
              <Route path="/invite/complete" element={<InviteComplete />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/daily" element={<DailyCare />} />
                <Route path="/plants" element={<PlantsList />} />
                <Route path="/plants/new" element={<PlantCreate />} />
                <Route path="/plants/:uuid" element={<PlantDetails />} />
                <Route path="/stats/:uuid" element={<PlantStats />} />
                <Route path="/plants/:uuid/edit" element={<PlantEdit />} />
                <Route path="/locations" element={<LocationsList />} />
                <Route path="/locations/new" element={<LocationCreate />} />
                <Route path="/locations/:id/edit" element={<LocationEdit />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/devices" element={<Devices />} />
                <Route path="/calibration" element={<Calibration />} />
                <Route path="/measurement/weight" element={<MeasurementCreate />} />
                <Route path="/measurement/watering" element={<WateringCreate />} />
                <Route path="/measurement/repotting" element={<RepottingCreate />} />
                <Route path="/measurements/bulk/weight" element={<BulkWeightMeasurement />} />
                <Route path="/measurements/bulk/watering" element={<BulkWatering />} />
                <Route path="/mfa/setup" element={<MFASetup />} />

                <Route element={<RequireAdmin />}>
                  <Route path="/admin" element={<AdminDashboard />} />
                </Route>
              </Route>
              <Route
                path="*"
                element={
                  <div style={{ padding: 24 }}>
                    <h1>404: Page Not Found</h1>
                    <p>Sorry, the page you are looking for does not exist.</p>
                    <a href="/dashboard">Go to Dashboard</a>
                  </div>
                }
              />
            </Routes>
          </BrowserRouter>
        </SettingsProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
