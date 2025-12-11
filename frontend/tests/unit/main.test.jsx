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
    expect(renderedElement.type && renderedElement.type.$$typeof ? 'fragment' : renderedElement.type).toBe(React.StrictMode)

    // StrictMode has a single child which is ThemeProvider
    const strictChildren = React.Children.toArray(renderedElement.props.children)
    expect(strictChildren).toHaveLength(1)
    const themeProvider = strictChildren[0]
    // ThemeProvider is provided by ThemeContext.jsx default export named ThemeProvider component
    // We can only validate by displayName or type.name as it’s a function component
    expect(themeProvider).toBeTruthy()
    expect(themeProvider.type?.name).toBe('ThemeProvider')

    // Next level: BrowserRouter > Routes with many Route children
    const tpChildren = React.Children.toArray(themeProvider.props.children)
    expect(tpChildren).toHaveLength(1)
    const browserRouter = tpChildren[0]
    // In tests, BrowserRouter is a function/component with name BrowserRouter
    expect(browserRouter.type?.name).toBe('BrowserRouter')

    const brChildren = React.Children.toArray(browserRouter.props.children)
    expect(brChildren).toHaveLength(1)
    const routes = brChildren[0]
    expect(routes.type?.name).toBe('Routes')

    const routeChildren = React.Children.toArray(routes.props.children)
    // We expect the exact number of <Route> entries defined in main.jsx
    // Keep this list synced with the file
    const expectedPaths = [
      '/',
      '/dashboard',
      '/daily',
      '/plants',
      '/plants/new',
      '/plants/:uuid',
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

    // Assert we have the same number of Route children
    expect(routeChildren.length).toBe(expectedPaths.length)

    // Extract path props from each child (they are <Route path=... element=... />)
    const actualPaths = routeChildren.map((r) => r.props?.path)
    expect(actualPaths).toEqual(expectedPaths)
  })
})
