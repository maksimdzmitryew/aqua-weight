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
import PlantDetails from './pages/PlantDetails.jsx'
import PlantStats from './pages/PlantStats.jsx'
import DailyCare from './pages/DailyCare.jsx'
import BulkWeightMeasurement from './pages/BulkWeightMeasurement.jsx'
import BulkWatering from './pages/BulkWatering.jsx'
import Calibration from './pages/Calibration.jsx'
import './styles/theme.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
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
          <Route path="/calibration" element={<Calibration />} />
          <Route path="/measurement/weight" element={<MeasurementCreate />} />
          <Route path="/measurement/watering" element={<WateringCreate />} />
          <Route path="/measurement/repotting" element={<RepottingCreate />} />
          <Route path="/measurements/bulk/weight" element={<BulkWeightMeasurement />} />
          <Route path="/measurements/bulk/watering" element={<BulkWatering />} />
          <Route path="*" element={<div style={{ padding: 24 }}><h1>404: Page Not Found</h1><p>Sorry, the page you are looking for does not exist.</p><a href="/dashboard">Go to Dashboard</a></div>} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
)
