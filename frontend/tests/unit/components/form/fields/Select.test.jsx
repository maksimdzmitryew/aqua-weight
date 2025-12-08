import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../../../src/ThemeContext.jsx'
import Select from '../../../../../src/components/form/fields/Select.jsx'
import { required, useForm } from '../../../../../src/components/form/useForm.js'

function Wrapper({ children }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

function FormWithSelect({ validators = [], disabled = false, requiredProp = false }) {
  const form = useForm({ choice: '' })
  return (
    <form>
      <Select form={form} name="choice" label="Choice" validators={validators} disabled={disabled} required={requiredProp} data-testid="choice-select">
        <option value="" disabled hidden>Pick</option>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>
    </form>
  )
}

describe('Select field', () => {
  test('renders label, options, allows selection; respects disabled/required', async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <Wrapper>
        <FormWithSelect requiredProp />
      </Wrapper>
    )

    const select = screen.getByLabelText(/choice/i)
    expect(select).toBeInTheDocument()
    expect(select).toBeRequired()

    // Options rendered
    expect(screen.getByRole('option', { name: 'A' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'B' })).toBeInTheDocument()

    // Change value
    await user.selectOptions(select, 'a')
    expect(select).toHaveValue('a')

    // Rerender disabled variant
    rerender(
      <Wrapper>
        <FormWithSelect disabled />
      </Wrapper>
    )
    const disabledSelect = screen.getByLabelText(/choice/i)
    expect(disabledSelect).toBeDisabled()
  })

  test('validation error displays on blur with aria attributes; clears after valid selection', async () => {
    const user = userEvent.setup()

    render(
      <Wrapper>
        <FormWithSelect validators={[required('Please pick one')]} />
      </Wrapper>
    )

    const select = screen.getByLabelText(/choice/i)
    // Blur without selection -> error
    await user.tab() // focus
    await user.tab() // blur

    expect(screen.getByText('Please pick one')).toBeInTheDocument()
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select.getAttribute('aria-describedby')).toBe('choice-error')

    // Fix by selecting a value then blur
    await user.selectOptions(select, 'b')
    await user.tab()
    expect(select).toHaveAttribute('aria-invalid', 'false')
  })

  test('applies dark theme styles and error border styles', async () => {
    window.localStorage.setItem('theme', 'dark')
    const user = userEvent.setup()

    render(
      <Wrapper>
        <FormWithSelect validators={[required()]} />
      </Wrapper>
    )
    const select = screen.getByLabelText(/choice/i)

    // Background reflects dark theme before error
    expect(select).toHaveStyle({ background: '#111827' })

    // Trigger validation error
    await user.tab()
    await user.tab()
    expect(select).toHaveStyle({ border: '1px solid crimson' })

    window.localStorage.removeItem('theme')
  })
})
