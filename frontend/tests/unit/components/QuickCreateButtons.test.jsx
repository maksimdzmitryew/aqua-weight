import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// SUT
import QuickCreateButtons from '../../../src/components/QuickCreateButtons.jsx'

// We mock useNavigate to observe navigation calls while keeping the rest of
// react-router-dom intact (MemoryRouter, Routes, Route, useLocation, etc.)
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    __esModule: true,
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderWithRouter(ui, { initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>
  )
}

describe('QuickCreateButtons', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('renders three action buttons and navigates with plant uuid and preserves from state', async () => {
    const user = userEvent.setup()
    const { container } = renderWithRouter(
      <QuickCreateButtons plantUuid="abc-123" plantName="Ficus" />,
      { initialEntries: ['/plants?tab=1'] }
    )

    // Wrapper gap uses default (compact=false) => 6px
    const wrapper = container.querySelector('span')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.style.gap).toBe('6px')

    // Buttons have labels including plantName
    const weightBtn = screen.getByRole('button', { name: 'Measurement for Ficus' })
    const waterBtn = screen.getByRole('button', { name: 'Watering for Ficus' })
    const repotBtn = screen.getByRole('button', { name: 'Repotting for Ficus' })

    await user.click(weightBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/measurement/weight?plant=abc-123', { state: { from: '/plants?tab=1' } })
    mockNavigate.mockClear()

    await user.click(waterBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/measurement/watering?plant=abc-123', { state: { from: '/plants?tab=1' } })
    mockNavigate.mockClear()

    await user.click(repotBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/measurement/repotting?plant=abc-123', { state: { from: '/plants?tab=1' } })
  })

  it('omits plant query when plantUuid is not provided; uses fallback labels and compact gap', async () => {
    const user = userEvent.setup()
    const { container } = renderWithRouter(
      <QuickCreateButtons compact={true} />,
      { initialEntries: ['/details'] }
    )

    // Wrapper gap for compact=true => 2px
    const wrapper = container.querySelector('span')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.style.gap).toBe('2px')

    // Fallback labels use 'plant'
    const weightBtn = screen.getByRole('button', { name: 'Measurement for plant' })
    const waterBtn = screen.getByRole('button', { name: 'Watering for plant' })
    const repotBtn = screen.getByRole('button', { name: 'Repotting for plant' })

    await user.click(weightBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/measurement/weight', { state: { from: '/details' } })
    mockNavigate.mockClear()

    await user.click(waterBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/measurement/watering', { state: { from: '/details' } })
    mockNavigate.mockClear()

    await user.click(repotBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/measurement/repotting', { state: { from: '/details' } })
  })
})
