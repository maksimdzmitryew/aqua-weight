import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../../../src/ThemeContext.jsx'
import DateTimeLocal from '../../../../../src/components/form/fields/DateTimeLocal.jsx'
import { required, useForm } from '../../../../../src/components/form/useForm.js'

function Wrapper({ children }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

function FormWithDate({ validators = [], disabled = false, requiredProp = false }) {
  const form = useForm({ dt: '' })
  return (
    <form>
      <DateTimeLocal
        form={form}
        name="dt"
        label="Date & Time"
        validators={validators}
        disabled={disabled}
        required={requiredProp}
        data-testid="dt-input"
      />
    </form>
  )
}

describe('DateTimeLocal field', () => {
  test('renders label, allows typing datetime string, respects required/disabled', async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <Wrapper>
        <FormWithDate requiredProp />
      </Wrapper>
    )

    const input = screen.getByLabelText(/date & time/i)
    expect(input).toBeInTheDocument()
    expect(input).toBeRequired()

    // Type a valid datetime-local value
    await user.type(input, '2025-12-08T10:30')
    expect(input).toHaveValue('2025-12-08T10:30')

    // Disabled variant
    rerender(
      <Wrapper>
        <FormWithDate disabled />
      </Wrapper>
    )
    const disabledInput = screen.getByLabelText(/date & time/i)
    expect(disabledInput).toBeDisabled()
  })

  test('shows validation error on blur and wires aria attributes', async () => {
    const user = userEvent.setup()

    render(
      <Wrapper>
        <FormWithDate validators={[required('Please provide date/time')]} />
      </Wrapper>
    )

    const input = screen.getByLabelText(/date & time/i)

    // Blur without value -> required error
    await user.tab()
    await user.tab()

    expect(screen.getByText('Please provide date/time')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBe('dt-error')

    // Fix: type a value and blur again
    await user.click(input)
    await user.type(input, '2024-01-01T00:00')
    await user.tab()
    expect(input).toHaveAttribute('aria-invalid', 'false')
  })

  test('applies dark theme styles and error border styles', async () => {
    window.localStorage.setItem('theme', 'dark')
    const user = userEvent.setup()

    render(
      <Wrapper>
        <FormWithDate validators={[required()]} />
      </Wrapper>
    )

    const input = screen.getByLabelText(/date & time/i)
    // Dark background before error
    expect(input).toHaveStyle({ background: '#111827' })

    // Trigger error and assert crimson border
    await user.tab()
    await user.tab()
    expect(input).toHaveStyle({ border: '1px solid crimson' })

    window.localStorage.removeItem('theme')
  })
})
