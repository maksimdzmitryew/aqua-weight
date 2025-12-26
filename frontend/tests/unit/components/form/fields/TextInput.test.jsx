import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../../../../src/ThemeContext.jsx'
import TextInput from '../../../../../src/components/form/fields/TextInput.jsx'
import { required, useForm } from '../../../../../src/components/form/useForm.js'

function Wrapper({ children }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

function FormWithText({ validators = [], disabled = false, requiredProp = false, placeholder = 'Type here' }) {
  const form = useForm({ name: '' })
  return (
    <form>
      <TextInput
        form={form}
        name="name"
        label="Name"
        placeholder={placeholder}
        validators={validators}
        disabled={disabled}
        required={requiredProp}
        data-testid="name-input"
      />
    </form>
  )
}

describe('TextInput field', () => {
  test('renders label, placeholder, supports typing and required/disabled props', async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <Wrapper>
        <FormWithText requiredProp placeholder="Your name" />
      </Wrapper>
    )

    const input = screen.getByRole('textbox', { name: /name/i })
    expect(input).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(input).toHaveAttribute('placeholder', 'Your name')
    expect(input).toBeRequired()

    await user.type(input, 'Alice')
    expect(input).toHaveValue('Alice')

    // Rerender disabled variant replacing previous tree
    rerender(
      <Wrapper>
        <FormWithText disabled />
      </Wrapper>
    )
    const disabledInput = screen.getByRole('textbox', { name: /name/i })
    expect(disabledInput).toBeDisabled()
  })

  test('shows validation error on blur and wires aria attributes', async () => {
    const user = userEvent.setup()

    render(
      <Wrapper>
        <FormWithText validators={[required('Please enter name')]}/>
      </Wrapper>
    )

    const input = screen.getByRole('textbox', { name: /name/i })
    // Blur without typing to trigger required error
    await user.tab() // focus
    await user.tab() // blur

    expect(screen.getByText('Please enter name')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBe('name-error')

    // Fix by typing then blurring again
    await user.click(input)
    await user.type(input, 'Bob')
    await user.tab()
    expect(input).toHaveAttribute('aria-invalid', 'false')
  })

  test('applies dark theme styles and error border styles', async () => {
    // Pre-set theme to dark so ThemeProvider picks it up on first render
    window.localStorage.setItem('theme', 'dark')

    const user = userEvent.setup()
    render(
      <Wrapper>
        <FormWithText validators={[required()]} />
      </Wrapper>
    )

    const input = screen.getByRole('textbox', { name: /name/i })
    // In dark mode and no error yet: background should be dark (#111827)
    expect(input).toHaveStyle({ background: '#111827' })

    // Trigger error to assert crimson border
    await user.tab()
    await user.tab()
    expect(input).toHaveStyle({ border: '1px solid crimson' })

    // Cleanup theme for subsequent tests
    window.localStorage.removeItem('theme')
  })
})
