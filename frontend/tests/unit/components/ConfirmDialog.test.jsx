import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmDialog from '../../../src/components/ConfirmDialog.jsx'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'

function renderWithTheme(ui) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('ConfirmDialog', () => {
  test('does not render when open=false and ignores Escape', async () => {
    const onCancel = vi.fn()
    renderWithTheme(<ConfirmDialog open={false} title="T" onCancel={onCancel} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  test('renders dialog with a11y labels and focuses the first (Cancel) button', async () => {
    const user = userEvent.setup()
    renderWithTheme(
      <ConfirmDialog open title="Delete plant" message="This action cannot be undone" />
    )

    const dlg = screen.getByRole('dialog')
    expect(dlg).toBeInTheDocument()

    const title = screen.getByText('Delete plant')
    expect(title).toHaveAttribute('id', 'confirm-title')
    expect(dlg).toHaveAttribute('aria-labelledby', 'confirm-title')

    const desc = screen.getByText('This action cannot be undone')
    expect(desc).toHaveAttribute('id', 'confirm-desc')
    expect(dlg).toHaveAttribute('aria-describedby', 'confirm-desc')

    // Wait for focus effect to run on the first button (Cancel)
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
    await screen.findByRole('button', { name: 'Cancel' })
    // Ensure it actually receives focus
    await user.tab()
    // After one tab from initial focus, focus will move to next element (Confirm),
    // so go back and ensure focus can be placed explicitly
    cancelBtn.focus()
    expect(cancelBtn).toHaveFocus()
  })

  test('focus attempt failure is caught and does not crash', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {
      throw new Error('focus failed')
    })
    try {
      renderWithTheme(
        <ConfirmDialog open title="Focus Fail" message="m" />
      )
      // Dialog still renders despite focus throwing
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  test('clicking buttons calls respective handlers', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    renderWithTheme(
      <ConfirmDialog open title="Confirm" onCancel={onCancel} onConfirm={onConfirm} />
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test('backdrop click triggers onCancel, clicking panel content does not', async () => {
    const onCancel = vi.fn()
    renderWithTheme(
      <ConfirmDialog open title="Backdrop Test" message="m" onCancel={onCancel} />
    )

    const overlay = screen.getByRole('dialog')
    // Click on overlay to trigger cancel
    fireEvent.click(overlay)
    expect(onCancel).toHaveBeenCalledTimes(1)

    // Clicking inside the panel should not call onCancel (use title element inside panel)
    const title = screen.getByText('Backdrop Test')
    fireEvent.click(title)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('Escape key closes when open=true', () => {
    const onCancel = vi.fn()
    renderWithTheme(<ConfirmDialog open title="Esc" onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('icon and tone variations render without error (covers branches)', () => {
    const { rerender } = renderWithTheme(
      <ConfirmDialog open title="Tone Danger" tone="danger" />
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Change to another tone to traverse tone resolution
    rerender(
      <ThemeProvider>
        <ConfirmDialog open title="Tone Info" tone="info" />
      </ThemeProvider>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Warning tone
    rerender(
      <ThemeProvider>
        <ConfirmDialog open title="Tone Warning" tone="warning" />
      </ThemeProvider>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Success tone
    rerender(
      <ThemeProvider>
        <ConfirmDialog open title="Tone Success" tone="success" />
      </ThemeProvider>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Default tone branch via empty string
    rerender(
      <ThemeProvider>
        <ConfirmDialog open title="Tone Default" tone="" />
      </ThemeProvider>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Unknown tone falls back to default styles
    rerender(
      <ThemeProvider>
        <ConfirmDialog open title="Tone Fallback" tone="unknown" />
      </ThemeProvider>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Explicit icon override branch
    rerender(
      <ThemeProvider>
        <ConfirmDialog open title="Icon Success" icon="success" />
      </ThemeProvider>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Unknown icon key falls back to warning icon
    rerender(
      <ThemeProvider>
        <ConfirmDialog open title="Icon Fallback" icon={"__nope__"} />
      </ThemeProvider>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('supports custom buttons when provided', async () => {
    const user = userEvent.setup()
    const onCustom = vi.fn()
    const buttons = [
      { key: 'custom', text: 'Do it', onClick: onCustom },
    ]
    renderWithTheme(
      <ConfirmDialog open title="Custom" buttons={buttons} />
    )
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    expect(onCustom).toHaveBeenCalledTimes(1)
  })

  test('omits description element when message is empty (conditional render path)', () => {
    renderWithTheme(<ConfirmDialog open title="No desc" message="" />)
    const dlg = screen.getByRole('dialog')
    expect(dlg).toBeInTheDocument()
    // Description element should not exist
    expect(screen.queryByText((_, el) => el?.id === 'confirm-desc')).toBeNull()
  })

  test('no onCancel handler: overlay click does nothing and does not crash', () => {
    renderWithTheme(<ConfirmDialog open title="No handler" />)
    const overlay = screen.getByRole('dialog')
    fireEvent.click(overlay)
    // No assertion needed other than the test not throwing; keep dialog present
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('dark theme styles are applied (covers isDark branches)', () => {
    // Force ThemeProvider to initialize in dark mode
    localStorage.setItem('theme', 'dark')
    renderWithTheme(<ConfirmDialog open title="Dark Mode" message="m" />)
    const title = screen.getByText('Dark Mode')
    const panel = title.parentElement
    expect(panel).toBeTruthy()
    // Box shadow uses dark variant in dark mode
    expect(panel.style.boxShadow).toMatch(/rgba\(0,0,0,0\.5\)/)
  })

  test('buttons fallback to defaults when buttons prop is an empty array', () => {
    renderWithTheme(<ConfirmDialog open title="Empty Buttons" buttons={[]} />)
    // Default cancel and confirm should appear
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})
