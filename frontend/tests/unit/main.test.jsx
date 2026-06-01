import React from 'react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mock CSS import used by main.jsx so importing the module doesn't error
vi.mock('../../src/styles/theme.css', () => ({}), { virtual: true })

// Mock all page components that main.jsx imports to keep the test lightweight
const stub = (name) => ({ default: () => React.createElement('div', { 'data-stub': name }) })
vi.mock('../../src/App.jsx', () => stub('App'))
vi.mock('../../src/pages/Dashboard.jsx', () => stub('Dashboard'))
vi.mock('../../src/pages/PlantsList.jsx', () => stub('PlantsList'))
vi.mock('../../src/pages/LocationsList.jsx', () => stub('LocationsList'))
vi.mock('../../src/pages/Settings.jsx', () => stub('Settings'))
vi.mock('../../src/pages/PlantEdit.jsx', () => stub('PlantEdit'))
vi.mock('../../src/pages/LocationEdit.jsx', () => stub('LocationEdit'))
vi.mock('../../src/pages/PlantCreate.jsx', () => stub('PlantCreate'))
vi.mock('../../src/pages/LocationCreate.jsx', () => stub('LocationCreate'))
vi.mock('../../src/pages/MeasurementCreate.jsx', () => stub('MeasurementCreate'))
vi.mock('../../src/pages/WateringCreate.jsx', () => stub('WateringCreate'))
vi.mock('../../src/pages/RepottingCreate.jsx', () => stub('RepottingCreate'))
vi.mock('../../src/pages/PlantDetails.jsx', () => stub('PlantDetails'))
vi.mock('../../src/pages/PlantStats.jsx', () => stub('PlantStats'))
vi.mock('../../src/pages/DailyCare.jsx', () => stub('DailyCare'))
vi.mock('../../src/pages/BulkWeightMeasurement.jsx', () => stub('BulkWeightMeasurement'))
vi.mock('../../src/pages/BulkWatering.jsx', () => stub('BulkWatering'))

// Capture createRoot and the element it renders for strict assertions
let renderSpy
let createRootSpy
let renderedElement

vi.mock('react-dom/client', async (orig) => {
  // Use actual module to not break named exports, then override createRoot
  const actual = await vi.importActual('react-dom/client')
  return {
    ...actual,
    createRoot: vi.fn((container) => {
      const root = {
        render: vi.fn((el) => {
          renderedElement = el
        }),
      }
      // expose spies to outer scope
      renderSpy = root.render
      return root
    }),
  }
})

// We will import main.jsx lazily inside tests to execute after DOM prepared

describe('src/main.jsx bootstrap', () => {
  beforeEach(() => {
    // Reset JSDOM root and spies
    document.body.innerHTML = '<div id="root"></div>'
    renderedElement = undefined
    vi.resetModules()
    // fresh spy reference after resetModules will reapply our mock factory
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('mounts React app into #root and renders strict tree with router and routes', async () => {
    // Import after setting up DOM so main.jsx can find #root
    await import('../../src/main.jsx')

    // Obtain the spy we installed via mocked createRoot
    const { createRoot } = await import('react-dom/client')
    createRootSpy = createRoot

    const rootEl = document.getElementById('root')
    expect(rootEl).toBeTruthy()
    expect(createRootSpy).toHaveBeenCalledTimes(1)
    expect(createRootSpy).toHaveBeenCalledWith(rootEl)

    expect(renderSpy).toHaveBeenCalledTimes(1)
    // Ensure we captured the element passed to render
    expect(renderedElement).toBeTruthy()

    // Strict assertions on the rendered element tree structure
    // renderedElement should be <React.StrictMode> ...
    expect(
      renderedElement.type && renderedElement.type.$$typeof ? 'fragment' : renderedElement.type,
    ).toBe(React.StrictMode)

    // StrictMode has a single child which is ThemeProvider
    const strictChildren = React.Children.toArray(renderedElement.props.children)
    expect(strictChildren).toHaveLength(1)
    const themeProvider = strictChildren[0]
    // ThemeProvider is provided by ThemeContext.jsx default export named ThemeProvider component
    // We can only validate by displayName or type.name as it’s a function component
    expect(themeProvider).toBeTruthy()
    expect(themeProvider.type?.name).toBe('ThemeProvider')

    // Next level: BrowserRouter > SessionManager and Routes
    const tpChildren = React.Children.toArray(themeProvider.props.children)
    expect(tpChildren).toHaveLength(1)
    const browserRouter = tpChildren[0]
    expect(browserRouter.type?.name).toBe('BrowserRouter')

    const brChildren = React.Children.toArray(browserRouter.props.children)
    expect(brChildren).toHaveLength(2)
    const sessionManager = brChildren[0]
    expect(sessionManager.type?.name).toBe('SessionManager')
    const routes = brChildren[1]
    expect(routes.type?.name).toBe('Routes')

    const routeChildren = React.Children.toArray(routes.props.children)
    // We expect public routes, a ProtectedRoute wrapper for restricted ones, and a catch-all
    const publicPaths = ['/', '/login', '/logout', '/invite/complete']
    const catchAllPath = '*'
    
    // Find the ProtectedRoute element (the one without a path prop)
    const protectedRoute = routeChildren.find((r) => !r.props?.path && r.props?.element?.type?.name === 'ProtectedRoute')
    expect(protectedRoute).toBeTruthy()
    
    // Extract nested paths from the ProtectedRoute
    const nestedRouteChildren = React.Children.toArray(protectedRoute.props.children)
    const nestedPaths = nestedRouteChildren.map((r) => r.props?.path)

    const expectedNestedPaths = [
      '/dashboard',
      '/daily',
      '/plants',
      '/plants/new',
      '/plants/:uuid',
      '/stats/:uuid',
      '/plants/:uuid/edit',
      '/locations',
      '/locations/new',
      '/locations/:id/edit',
      '/settings',
      '/calibration',
      '/measurement/weight',
      '/measurement/watering',
      '/measurement/repotting',
      '/measurements/bulk/weight',
      '/measurements/bulk/watering',
    ]

    expect(nestedPaths).toEqual(expectedNestedPaths)

    // Assert top-level routes
    const topLevelPaths = routeChildren.map((r) => r.props?.path)
    expect(topLevelPaths).toContain('/')
    expect(topLevelPaths).toContain('/login')
    expect(topLevelPaths).toContain('/logout')
    expect(topLevelPaths).toContain('/invite/complete')
    expect(topLevelPaths).toContain('*')
  })
})
