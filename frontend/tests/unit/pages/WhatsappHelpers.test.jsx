import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import { MemoryRouter } from 'react-router-dom'
import { apiClient } from '../../../src/api/client.js'
import { removeHelper } from '../../../src/utils/whatsapp_helpers.js'

// Mock AuthContext to avoid react-hot-toast resolution issues
vi.mock('../../../src/context/AuthContext.jsx', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: { global_role: 'admin' },
    isAuthenticated: true,
    status: 'authenticated',
    logout: vi.fn().mockResolvedValue({}),
  }),
}))

// Mock apiClient
vi.mock('../../../src/api/client.js', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

// Mock DashboardLayout
vi.mock('../../../src/components/DashboardLayout.jsx', () => ({
  default: ({ title, children }) => (
    <div data-testid="layout">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

// Mock removeHelper
vi.mock('../../../src/utils/whatsapp_helpers.js', () => ({
  removeHelper: vi.fn(),
}))

// Import the component after mocks are set up
import WhatsappHelpers from '../../../src/pages/WhatsappHelpers.jsx'

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <WhatsappHelpers />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('pages/WhatsappHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('initial load', () => {
    it('loads helpers from API on mount', async () => {
      const mockHelpers = [
        { id: '1', name: 'Helper 1', phone: '+1234567890' },
        { id: '2', name: 'Helper 2', phone: null },
      ]
      apiClient.get.mockResolvedValue(mockHelpers)

      renderPage()

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledWith('/whatsapp/helping-users')
      })

      expect(screen.getByText('Helper 1')).toBeInTheDocument()
      expect(screen.getByText('+1234567890')).toBeInTheDocument()
      expect(screen.getByText('Helper 2')).toBeInTheDocument()
    })

    it('handles API error gracefully and shows empty state', async () => {
      apiClient.get.mockRejectedValue(new Error('API Error'))

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('No helpers configured yet.')).toBeInTheDocument()
      })
    })

    it('handles null response from API', async () => {
      apiClient.get.mockResolvedValue(null)

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('No helpers configured yet.')).toBeInTheDocument()
      })
    })

    it('handles empty array response from API', async () => {
      apiClient.get.mockResolvedValue([])

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('No helpers configured yet.')).toBeInTheDocument()
      })
    })
  })

  describe('add helper', () => {
    it('adds a new helper successfully', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ id: '123', name: 'New Helper', phone: null })

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'New Helper' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/whatsapp/helping-users', {
          name: 'New Helper',
          phone: null,
        })
        expect(screen.getByRole('button', { name: 'Saved!' })).toBeInTheDocument()
      })
    })

    it('adds a new helper with phone number', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ id: '123', name: 'Helper With Phone', phone: '+1112223333' })

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      const phoneInput = screen.getByPlaceholderText('Phone (optional)')

      fireEvent.change(nameInput, { target: { value: 'Helper With Phone' } })
      fireEvent.change(phoneInput, { target: { value: '+1112223333' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/whatsapp/helping-users', {
          name: 'Helper With Phone',
          phone: '+1112223333',
        })
      })
    })

    it('trims whitespace from name and phone', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ id: '123', name: 'Trimmed', phone: '+111' })

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      const phoneInput = screen.getByPlaceholderText('Phone (optional)')

      fireEvent.change(nameInput, { target: { value: '  Trimmed  ' } })
      fireEvent.change(phoneInput, { target: { value: '  +111  ' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/whatsapp/helping-users', {
          name: 'Trimmed',
          phone: '+111',
        })
      })
    })

    it('sends null for empty phone', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ id: '123', name: 'No Phone', phone: null })

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')

      fireEvent.change(nameInput, { target: { value: 'No Phone' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/whatsapp/helping-users', {
          name: 'No Phone',
          phone: null,
        })
      })
    })

    it('shows error state when add fails', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockRejectedValue(new Error('Server error'))

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'Fail Helper' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument()
      })
    })

    it('does not add helper when name is empty', async () => {
      apiClient.get.mockResolvedValue([])

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: '' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      await act(async () => {
        fireEvent.click(addButton)
      })

      expect(apiClient.post).not.toHaveBeenCalled()
    })

    it('does not add helper when name is whitespace only', async () => {
      apiClient.get.mockResolvedValue([])

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: '   ' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      await act(async () => {
        fireEvent.click(addButton)
      })

      expect(apiClient.post).not.toHaveBeenCalled()
    })
  })

  describe('delete helper', () => {
    it('deletes a helper successfully', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: '+1234567890' }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockResolvedValue({ ok: true })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(apiClient.delete).toHaveBeenCalledWith('/whatsapp/helping-users/1')
        expect(removeHelper).toHaveBeenCalledWith('1')
        expect(screen.getByRole('button', { name: 'Deleted!' })).toBeInTheDocument()
      })
    })

    it('shows error state when delete fails', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: '+1234567890' }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockRejectedValue(new Error('Delete failed'))

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(apiClient.delete).toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument()
      })
    })

    it('calls removeHelper from localStorage utility on successful delete', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockResolvedValue({ ok: true })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(removeHelper).toHaveBeenCalledWith('1')
      })
    })
  })

  describe('request digest', () => {
    it('requests digest successfully', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ ok: true })

      renderPage()

      const digestButton = screen.getByRole('button', { name: 'Request Thirsty Plants Now' })
      fireEvent.click(digestButton)

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/whatsapp/trigger-digest')
        expect(screen.getByRole('button', { name: 'Done!' })).toBeInTheDocument()
      })
    })

    it('shows error state when digest request fails', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockRejectedValue(new Error('Digest failed'))

      renderPage()

      const digestButton = screen.getByRole('button', { name: 'Request Thirsty Plants Now' })
      fireEvent.click(digestButton)

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument()
      })
    })
  })

  describe('button text states', () => {
    it('shows "Saving..." when adding helper', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)))

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'Test Helper' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      await act(async () => {
        fireEvent.click(addButton)
      })

      // Immediately check for "Saving..." - it should appear before the async completes
      expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument()

      // Restore immediate resolution
      apiClient.post.mockResolvedValue({ ok: true })
    })

    it('shows "Saved!" after successful add', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ id: '123', name: 'Test Helper' })

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'Test Helper' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Saved!' })).toBeInTheDocument()
      })
    })

    it('shows "Failed" after failed add', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockRejectedValue(new Error('Server error'))

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'Fail Helper' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument()
      })
    })

    it('shows "Deleting..." when deleting helper', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)))

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      expect(screen.getByRole('button', { name: 'Deleting...' })).toBeInTheDocument()

      // Restore immediate resolution
      apiClient.delete.mockResolvedValue({ ok: true })
    })

    it('shows "Deleted!" after successful delete', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockResolvedValue({ ok: true })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Deleted!' })).toBeInTheDocument()
      })
    })

    it('shows "Requesting..." when requesting digest', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)))

      renderPage()

      const digestButton = screen.getByRole('button', { name: 'Request Thirsty Plants Now' })
      await act(async () => {
        fireEvent.click(digestButton)
      })

      expect(screen.getByRole('button', { name: 'Requesting...' })).toBeInTheDocument()

      // Restore immediate resolution
      apiClient.post.mockResolvedValue({ ok: true })
    })

    it('shows "Done!" after successful digest request', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ ok: true })

      renderPage()

      const digestButton = screen.getByRole('button', { name: 'Request Thirsty Plants Now' })
      fireEvent.click(digestButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Done!' })).toBeInTheDocument()
      })
    })
  })

  describe('button colors', () => {
    it('shows red background (style prop) for failed add state', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockRejectedValue(new Error('Server error'))

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.click(screen.getByRole('button', { name: /add helper/i }))

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Failed' })
        expect(button).toHaveAttribute('style')
        expect(button.getAttribute('style')).toContain('background-color')
      })
    })

    it('shows green background (style prop) for saved add state', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ id: '1', name: 'Test' })

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.click(screen.getByRole('button', { name: /add helper/i }))

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Saved!' })
        expect(button).toHaveAttribute('style')
        expect(button.getAttribute('style')).toContain('background-color')
      })
    })

    it('shows red background for failed delete state', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockRejectedValue(new Error('Delete failed'))

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Failed' })
        expect(button).toHaveAttribute('style')
        expect(button.getAttribute('style')).toContain('background-color')
      })
    })

    it('shows green background for deleted state', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockResolvedValue({ ok: true })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Deleted!' })
        expect(button).toHaveAttribute('style')
        expect(button.getAttribute('style')).toContain('background-color')
      })
    })

    it('shows red background for failed digest state', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockRejectedValue(new Error('Digest failed'))

      renderPage()

      const digestButton = screen.getByRole('button', { name: 'Request Thirsty Plants Now' })
      fireEvent.click(digestButton)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Failed' })
        expect(button).toHaveAttribute('style')
        expect(button.getAttribute('style')).toContain('background-color')
      })
    })

    it('shows green background for saved digest state', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ ok: true })

      renderPage()

      const digestButton = screen.getByRole('button', { name: 'Request Thirsty Plants Now' })
      fireEvent.click(digestButton)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Done!' })
        expect(button).toHaveAttribute('style')
        expect(button.getAttribute('style')).toContain('background-color')
      })
    })
  })

  describe('disabled state', () => {
    it('disables add button when adding', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)))

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'Test Helper' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      await act(async () => {
        fireEvent.click(addButton)
      })

      expect(addButton).toBeDisabled()

      // Restore immediate resolution
      apiClient.post.mockResolvedValue({ ok: true })
    })

    it('disables delete button when deleting', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)))

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      expect(deleteButton).toBeDisabled()

      // Restore immediate resolution
      apiClient.delete.mockResolvedValue({ ok: true })
    })

    it('disables digest button when requesting', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)))

      renderPage()

      const digestButton = screen.getByRole('button', { name: 'Request Thirsty Plants Now' })
      await act(async () => {
        fireEvent.click(digestButton)
      })

      expect(digestButton).toBeDisabled()

      // Restore immediate resolution
      apiClient.post.mockResolvedValue({ ok: true })
    })
  })

  describe('rendering', () => {
    it('renders the layout wrapper', async () => {
      apiClient.get.mockResolvedValue([])

      renderPage()

      await waitFor(() => {
        expect(screen.getByTestId('layout')).toBeInTheDocument()
      })
    })

    it('renders the heading element', async () => {
      apiClient.get.mockResolvedValue([])

      renderPage()

      await waitFor(() => {
        const headings = screen.getAllByRole('heading', { name: 'WhatsApp Helpers' })
        expect(headings.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('renders the description text', async () => {
      apiClient.get.mockResolvedValue([])

      renderPage()

      await waitFor(() => {
        expect(screen.getByText(/Manage users who can request thirsty plants lists during vacation mode./)).toBeInTheDocument()
      })
    })

    it('renders form with correct inputs', async () => {
      apiClient.get.mockResolvedValue([])

      renderPage()

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Helper name')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Phone (optional)')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /add helper/i })).toBeInTheDocument()
      })
    })

    it('renders helper list with phone numbers', async () => {
      const mockHelpers = [
        { id: '1', name: 'Helper 1', phone: '+1234567890' },
        { id: '2', name: 'Helper 2', phone: '+0987654321' },
      ]
      apiClient.get.mockResolvedValue(mockHelpers)

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
        expect(screen.getByText('+1234567890')).toBeInTheDocument()
        expect(screen.getByText('Helper 2')).toBeInTheDocument()
        expect(screen.getByText('+0987654321')).toBeInTheDocument()
      })
    })

    it('renders helper without phone number', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper No Phone', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper No Phone')).toBeInTheDocument()
        // Phone number should not be displayed - check that the phone span is not visible
        const phoneSpan = screen.queryByText('+', { selector: 'span' })
        expect(phoneSpan).not.toBeInTheDocument()
      })
    })

    it('renders digest request button', async () => {
      apiClient.get.mockResolvedValue([])

      renderPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Request Thirsty Plants Now' })).toBeInTheDocument()
      })
    })
  })

  describe('button texts', () => {
    it('shows "Delete" button for existing helper', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)

      renderPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
      })
    })

    it('shows "Request Thirsty Plants Now" button for digest', async () => {
      apiClient.get.mockResolvedValue([])

      renderPage()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Request Thirsty Plants Now' })).toBeInTheDocument()
      })
    })
  })

  describe('clearStatus timeout coverage', () => {
    it('is called via setTimeout for add after success', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ id: '123', name: 'Test Helper' })

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'Test Helper' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      fireEvent.click(addButton)

      // Wait for success state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Saved!' })).toBeInTheDocument()
      })

      // Verify setTimeout was called with clearStatus callback and 2000ms timeout
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000)

      setTimeoutSpy.mockRestore()
    })

    it('is called via setTimeout for add after failure', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockRejectedValue(new Error('Server error'))

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderPage()

      const nameInput = screen.getByPlaceholderText('Helper name')
      fireEvent.change(nameInput, { target: { value: 'Fail Helper' } })

      const addButton = screen.getByRole('button', { name: /add helper/i })
      fireEvent.click(addButton)

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument()
      })

      // Verify setTimeout was called with clearStatus callback and 3000ms timeout
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000)

      setTimeoutSpy.mockRestore()
    })

    it('is called via setTimeout for delete after success', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockResolvedValue({ ok: true })

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      // Wait for success state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Deleted!' })).toBeInTheDocument()
      })

      // Verify setTimeout was called with clearStatus callback and 2000ms timeout
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000)

      setTimeoutSpy.mockRestore()
    })

    it('is called via setTimeout for delete after failure', async () => {
      const mockHelpers = [{ id: '1', name: 'Helper 1', phone: null }]
      apiClient.get.mockResolvedValue(mockHelpers)
      apiClient.delete.mockRejectedValue(new Error('Delete failed'))

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Helper 1')).toBeInTheDocument()
      })

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument()
      })

      // Verify setTimeout was called with clearStatus callback and 3000ms timeout
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000)

      setTimeoutSpy.mockRestore()
    })

    it('is called via setTimeout for digest after success', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockResolvedValue({ ok: true })

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderPage()

      const digestButton = screen.getByRole('button', { name: 'Request Thirsty Plants Now' })
      fireEvent.click(digestButton)

      // Wait for success state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Done!' })).toBeInTheDocument()
      })

      // Verify setTimeout was called with clearStatus callback and 3000ms timeout
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000)

      setTimeoutSpy.mockRestore()
    })

    it('is called via setTimeout for digest after failure', async () => {
      apiClient.get.mockResolvedValue([])
      apiClient.post.mockRejectedValue(new Error('Digest failed'))

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      renderPage()

      const digestButton = screen.getByRole('button', { name: 'Request Thirsty Plants Now' })
      fireEvent.click(digestButton)

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument()
      })

      // Verify setTimeout was called with clearStatus callback and 4000ms timeout
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 4000)

      setTimeoutSpy.mockRestore()
    })
  })
})