import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../../../src/ThemeContext.jsx'
import NumberInput from '../../../../../src/components/form/fields/NumberInput.jsx'
import { required, minNumber, maxNumber, useForm } from '../../../../../src/components/form/useForm.js'

function Wrapper({ children }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

function FormWithNumber({ validators = [], disabled = false, requiredProp = false, placeholder = '0', min, max, step }) {
  const form = useForm({ qty: '' })
  return (
    <form>
      <NumberInput
        form={form}
        name="qty"
        label="Quantity"
        placeholder={placeholder}
        validators={validators}
        disabled={disabled}
        required={requiredProp}
        min={min}
        max={max}
        step={step}
        data-testid="qty-input"
      />
    </form>
  )
}

describe('NumberInput field', () => {
  test('renders label, placeholder, numeric typing and respects min/max/step and required/disabled', async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <Wrapper>
        <FormWithNumber requiredProp placeholder="Enter qty" min={0} max={10} step={2} />
      </Wrapper>
    )

    const input = screen.getByLabelText(/quantity/i)
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('placeholder', 'Enter qty')
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '10')
    expect(input).toHaveAttribute('step', '2')

    await user.type(input, '6')
    expect(input).toHaveValue(6)

    // Disabled variant
    rerender(
      <Wrapper>
        <FormWithNumber disabled />
      </Wrapper>
    )
    const disabledInput = screen.getByLabelText(/quantity/i)
    expect(disabledInput).toBeDisabled()
  })

  test('validators: required, then min and max errors with aria wiring', async () => {
    const user = userEvent.setup()

    render(
      <Wrapper>
        <FormWithNumber validators={[minNumber(2), maxNumber(5), required('Needed')]} />
      </Wrapper>
    )
    const input = screen.getByLabelText(/quantity/i)

    // Blur empty -> required error
    await user.tab()
    await user.tab()
    expect(screen.getByText('Needed')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBe('qty-error')

    // Too small -> min error
    await user.click(input)
    await user.clear(input)
    await user.type(input, '1')
    await user.tab()
    expect(screen.getByText('Must be >= 2')).toBeInTheDocument()

    // Too large -> max error
    await user.click(input)
    await user.clear(input)
    await user.type(input, '6')
    await user.tab()
    expect(screen.getByText('Must be <= 5')).toBeInTheDocument()

    // In range -> valid
    await user.click(input)
    await user.clear(input)
    await user.type(input, '3')
    await user.tab()
    expect(input).toHaveAttribute('aria-invalid', 'false')
  })

  test('applies dark theme styles and error border styles', async () => {
    window.localStorage.setItem('theme', 'dark')
    const user = userEvent.setup()

    render(
      <Wrapper>
        <FormWithNumber validators={[required()]} />
      </Wrapper>
    )
    const input = screen.getByLabelText(/quantity/i)

    expect(input).toHaveStyle({ background: '#111827' })

    // Trigger error border
    await user.tab()
    await user.tab()
    expect(input).toHaveStyle({ border: '1px solid crimson' })

    window.localStorage.removeItem('theme')
  })
})
