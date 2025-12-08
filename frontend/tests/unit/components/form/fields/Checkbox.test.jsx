import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../../../src/ThemeContext.jsx'
import Checkbox from '../../../../../src/components/form/fields/Checkbox.jsx'
import { required, useForm } from '../../../../../src/components/form/useForm.js'

function Wrapper({ children, theme = 'light' }) {
  // Provide ThemeContext as components rely on useTheme
  return <ThemeProvider>{children}</ThemeProvider>
}

function FormWithCheckboxes() {
  const form = useForm({ agree: false })
  return (
    <form>
      <Checkbox form={form} name="agree" label="I agree" required data-testid="agree" />
      <Checkbox form={form} name="agree2" label="Term" disabled data-testid="agree2" />
    </form>
  )
}

function FormWithValidation() {
  const form = useForm({ policy: false })
  return (
    <form>
      {/* For checkbox, validate that value is true */}
      <Checkbox form={form} name="policy" label="Accept policy" validators={[v => v === true || 'Please accept']} />
    </form>
  )
}

describe('Checkbox field', () => {
  test('renders label, toggles value, and respects disabled/required props', async () => {
    const user = userEvent.setup()

    render(
      <Wrapper>
        <FormWithCheckboxes />
      </Wrapper>
    )

    // Renders label text
    expect(screen.getByText('I agree')).toBeInTheDocument()

    const cb = screen.getByRole('checkbox', { name: /i agree/i })
    expect(cb).toBeInTheDocument()
    // default unchecked
    expect(cb).not.toBeChecked()
    // required reflected
    expect(cb).toBeRequired()

    // Toggle on
    await user.click(cb)
    expect(cb).toBeChecked()

    // Toggle off
    await user.click(cb)
    expect(cb).not.toBeChecked()

    const cb2 = screen.getByRole('checkbox', { name: /term/i })
    expect(cb2).toBeDisabled()
  })

  test('shows validation error and aria attributes when invalid', async () => {
    const user = userEvent.setup()

    render(
      <Wrapper>
        <FormWithValidation />
      </Wrapper>
    )

    const cb = screen.getByRole('checkbox', { name: /accept policy/i })
    // Blur to mark touched and trigger validation
    await user.tab() // focus first focusable (checkbox)
    await user.tab() // blur it

    // Error should appear
    expect(screen.getByText('Please accept')).toBeInTheDocument()
    // aria-invalid should be true and aria-describedby should reference error id
    expect(cb).toHaveAttribute('aria-invalid', 'true')
    const describedBy = cb.getAttribute('aria-describedby')
    expect(describedBy).toBe('policy-error')

    // Now fix by checking it; error should clear on change after touched
    await user.click(cb)
    expect(cb).toBeChecked()
    // Error element may still be in DOM depending on implementation timing, but content must be empty string after change.
    // We assert aria-invalid flips to false by re-blurring
    await user.tab() // blur again
    expect(cb).toHaveAttribute('aria-invalid', 'false')
  })
})
