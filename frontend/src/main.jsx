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
import PlantCreate from './pages/PlantCreate.jsx'
import LocationCreate from './pages/LocationCreate.jsx'
import MeasurementCreate from './pages/MeasurementCreate.jsx'
import WateringCreate from './pages/WateringCreate.jsx'
import RepottingCreate from './pages/RepottingCreate.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/plants" element={<PlantsList />} />
          <Route path="/plants/new" element={<PlantCreate />} />
          <Route path="/plants/:id/edit" element={<PlantEdit />} />
          <Route path="/locations" element={<LocationsList />} />
          <Route path="/locations/new" element={<LocationCreate />} />
          <Route path="/locations/:id/edit" element={<LocationEdit />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/measurement/measurement" element={<MeasurementCreate />} />
          <Route path="/measurement/watering" element={<WateringCreate />} />
          <Route path="/measurement/repotting" element={<RepottingCreate />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
)
