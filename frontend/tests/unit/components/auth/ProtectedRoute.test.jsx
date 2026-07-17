import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import ProtectedRoute from '../../../../src/components/auth/ProtectedRoute'
import { useAuth } from '../../../../src/context/AuthContext'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

describe('ProtectedRoute', () => {
  it('redirects to /login if not authenticated', () => {
    useAuth.mockReturnValue({ isAuthenticated: false })
    
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/protected" element={<ProtectedRoute><div>Secret</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    )
    
    expect(screen.getByText('Login Page')).toBeInTheDocument()
    expect(screen.queryByText('Secret')).not.toBeInTheDocument()
  })

  it('renders children if authenticated', () => {
    useAuth.mockReturnValue({ isAuthenticated: true })
    
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/protected" element={<ProtectedRoute><div>Secret</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    )
    
    expect(screen.getByText('Secret')).toBeInTheDocument()
  })

  it('renders Outlet if no children provided and authenticated', () => {
    useAuth.mockReturnValue({ isAuthenticated: true })
    
    render(
      <MemoryRouter initialEntries={['/parent/child']}>
        <Routes>
          <Route path="/parent" element={<ProtectedRoute />}>
             <Route path="child" element={<div>Child Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    
    expect(screen.getByText('Child Content')).toBeInTheDocument()
  })
})
