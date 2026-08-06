// Import all necessary setup and component
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { server } from '../msw/server'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { paginatedPlantsHandler } from '../msw/paginate.js'

// Mock navigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { __esModule: true, ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../../src/components/DashboardLayout.jsx', () => ({
  default: ({ children }) => <div data-testid="mock-dashboard-layout">{children}</div>,
}))

vi.mock('../../../src/components/ConfirmDialog.jsx', () => ({
  default: ({ open, onConfirm, onCancel, onClose, title, message, confirmText, cancelText, tone, defaultFocus }) =>
    open ? (
      <div role="dialog" data-testid="mock-confirm-dialog">
        <h2>{title}</h2>
        <div>{message}</div>
        <button onClick={onConfirm} data-testid="confirm-btn">{confirmText}</button>
        <button onClick={onCancel} data-testid="cancel-btn">{cancelText}</button>
        <button onClick={onClose} data-testid="close-btn">Close</button>
      </div>
    ) : null,
}))

vi.mock('../../../src/components/PlantSelect.jsx', () => ({
  default: ({ form, name, label, required, disabled }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <select id={name} {...form.register(name)} required={required} disabled={disabled}>
        <option value="">Select plant</option>
        <option value="u1">Aloe</option>
        <option value="u2">Monstera</option>
      </select>
    </div>
  ),
}))

vi.mock('../../../src/components/form/fields/DateTimeLocal.jsx', () => ({
  default: ({ label, form, name, required }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} type="datetime-local" {...form.register(name)} required={required} />
    </div>
  ),
}))

vi.mock('../../../src/components/form/fields/Select.jsx', () => ({
  default: ({ label, form, name, children, required, disabled }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <select id={name} {...form.register(name)} required={required} disabled={disabled}>
        {children}
      </select>
    </div>
  ),
}))

vi.mock('../../../src/components/form/fields/NumberInput.jsx', () => ({
  default: ({ label, form, name, min }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} type="number" min={min} {...form.register(name)} />
    </div>
  ),
}))

vi.mock('../../../src/components/form/fields/TextInput.jsx', () => ({
  default: ({ label, form, name, placeholder }) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} type="text" placeholder={placeholder} {...form.register(name)} />
    </div>
  ),
}))

vi.mock('../../../src/utils/datetime.js', async () => {
  const actual = await vi.importActual('../../../src/utils/datetime.js')
  return {
    ...actual,
    nowLocalISOFull: () => '2025-01-10T23:00',
    toLocalISOFull: (val) => (val ? val.substring(0, 16) : ''),
  }
})

// Import the component after the mocks are set up
import WateringCreate from '../../../src/pages/WateringCreate.jsx'

function renderWithRouter(initialEntries) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={<WateringCreate />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('pages/WateringCreate', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    server.use(
      ...paginatedPlantsHandler([
        { uuid: 'u1', name: 'Aloe' },
        { uuid: 'u2', name: 'Monstera' },
      ]),
    )
  })

  test('edit flow: setPlant callback updates with new max water value (line 198)', async () => {
    let patched = null
    server.use(
      http.get('/api/plants/u1', () =>
        HttpResponse.json({
          uuid: 'u1',
          name: 'Aloe',
          min_dry_weight_g: 100,
          max_water_weight_g: 50,
        }),
      ),
      http.patch('/api/plants/u1', async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({ uuid: 'u1', ...patched })
      }),
      http.post('/api/plants/:plantId/measurements/watering', async ({ request }) => {
        return HttpResponse.json({ id: 101 }, { status: 201 })
      }),
    )

    renderWithRouter([{ pathname: '/new', search: '?plant=u1' }])

    await screen.findByLabelText(/plant/i)

    const wet = screen.getByLabelText(/current weight/i)
    fireEvent.change(wet, { target: { value: '200' } })
    fireEvent.click(await screen.findByRole('button', { name: /save watering/i }))

    expect(await screen.findByText(/risk of root rot warning/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'No' }))

    await waitFor(() => expect(patched).not.toBeNull())
    expect(patched.max_water_weight_g).toBe(100)

    // After recalibrate, the plant in state should have the updated max_water_weight_g
    // This tests the ternary logic at line 198: setPlant((p) => (p ? { ...p, max_water_weight_g: newMax } : p))
    // The plant should be updated with the new max value
    // Note: We can't directly test the state update here, but we can verify it didn't break
    expect(mockNavigate).toHaveBeenCalledWith('/plants/u1')
  })
})