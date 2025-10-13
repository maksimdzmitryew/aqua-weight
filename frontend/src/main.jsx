import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import Dashboard from './pages/Dashboard.jsx'
import PlantsList from './pages/PlantsList.jsx'
import LocationsList from './pages/LocationsList.jsx'
import Settings from './pages/Settings.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import PlantEdit from './pages/PlantEdit.jsx'
import LocationEdit from './pages/LocationEdit.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/plants" element={<PlantsList />} />
          <Route path="/plants/:id/edit" element={<PlantEdit />} />
          <Route path="/locations" element={<LocationsList />} />
          <Route path="/locations/:id/edit" element={<LocationEdit />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
)
