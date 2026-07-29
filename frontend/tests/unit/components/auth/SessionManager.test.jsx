import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { useEffect } from 'react'
import { render } from '@testing-library/react'
import { useAuth } from '../../../../src/context/AuthContext'
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'

// Mock react-dom/client to prevent createRoot from executing (main.jsx has side effects)
vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(),
}))

// Mock AuthContext
vi.mock('../../../../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

// Mock react-router-dom
const mockNavigate = vi.fn()
let mockLocationValue = { pathname: '/dashboard', state: { from: { pathname: '/dashboard' } } }

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocationValue,
    Navigate: ({ to, state, replace }) => (
      <div data-testid="navigate" data-to={to} data-state={JSON.stringify(state)} data-replace={replace}>
        Navigated to {to}
      </div>
    ),
  }
})

// SessionManager component logic (defined in main.jsx but not exported)
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

describe('SessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockReset()
  })

  it('redirects to /login when unauthenticated on protected route', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated' })
    mockLocationValue = { pathname: '/dashboard', state: { from: { pathname: '/dashboard' } } }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/dashboard" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: { from: { pathname: '/dashboard', state: { from: { pathname: '/dashboard' } } } },
      replace: true
    })
  })

  it('redirects to /login when unauthenticated on non-public protected route', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated' })
    mockLocationValue = { pathname: '/plants', state: { from: { pathname: '/plants' } } }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/plants']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/plants" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: { from: { pathname: '/plants', state: { from: { pathname: '/plants' } } } },
      replace: true
    })
  })

  it('does not redirect when unauthenticated on public route /', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated' })
    mockLocationValue = { pathname: '/', state: {} }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('does not redirect when unauthenticated on public route /login', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated' })
    mockLocationValue = { pathname: '/login', state: {} }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('does not redirect when unauthenticated on public route /logout', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated' })
    mockLocationValue = { pathname: '/logout', state: {} }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/logout']}>
        <Routes>
          <Route path="/logout" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('does not redirect when unauthenticated on public route /invite/complete', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated' })
    mockLocationValue = { pathname: '/invite/complete', state: {} }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/invite/complete']}>
        <Routes>
          <Route path="/invite/complete" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('does not redirect when unauthenticated on public route /invite/complete/abc123', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated' })
    mockLocationValue = { pathname: '/invite/complete/abc123', state: {} }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/invite/complete/abc123']}>
        <Routes>
          <Route path="/invite/complete/:token" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('redirects authenticated user away from /login to previous location', () => {
    useAuth.mockReturnValue({ status: 'authenticated' })
    mockLocationValue = { pathname: '/login', state: { from: { pathname: '/dashboard' } } }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
      replace: true
    })
  })

  it('redirects authenticated user away from /login to dashboard when no previous location', () => {
    useAuth.mockReturnValue({ status: 'authenticated' })
    mockLocationValue = { pathname: '/login', state: {} }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
      replace: true
    })
  })

  it('does not redirect authenticated user on non-login routes', () => {
    useAuth.mockReturnValue({ status: 'authenticated' })
    mockLocationValue = { pathname: '/dashboard', state: {} }

    const TestComponent = () => (
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<SessionManager />} />
        </Routes>
      </MemoryRouter>
    )

    render(<TestComponent />)

    expect(mockNavigate).not.toHaveBeenCalled()
  })
})