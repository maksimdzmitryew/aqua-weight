import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../src/ThemeContext.jsx'
import TextInput from '../../src/components/form/fields/TextInput.jsx'

function makeForm({ defaultValue = '', error = '' } = {}) {
  const state = { value: defaultValue, errors: error ? { name: error } : {} }
  return {
    get value() { return state.value },
    get errors() { return state.errors },
    register(field) {
      return {
        name: field,
        value: state.value,
        onChange: (e) => { state.value = e.target.value },
      }
    },
  }
}

function renderWithTheme(ui) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

test('renders label and associates with input', () => {
  const form = makeForm()
  renderWithTheme(<TextInput form={form} name="name" label="Plant name" placeholder="Enter name" />)
  const input = screen.getByLabelText('Plant name')
  expect(input).toBeInTheDocument()
  expect(input).toHaveAttribute('id', 'name')
  expect(input).toHaveAttribute('type', 'text')
})

test('accepts typing and updates form value', async () => {
  const user = userEvent.setup()
  const form = makeForm()
  renderWithTheme(<TextInput form={form} name="name" label="Name" />)
  const input = screen.getByLabelText('Name')
  await user.clear(input)
  await user.type(input, 'Monstera')
  expect(form.value).toBe('Monstera')
})

test('shows required and disabled attributes when provided', () => {
  const form = makeForm()
  renderWithTheme(<TextInput form={form} name="name" label="Name" required disabled />)
  const input = screen.getByLabelText('Name')
  expect(input).toBeRequired()
  expect(input).toBeDisabled()
})

test('renders error message and aria attributes when error exists', () => {
  const form = makeForm({ error: 'This field is required' })
  renderWithTheme(<TextInput form={form} name="name" label="Name" />)
  const err = screen.getByText('This field is required')
  expect(err).toBeInTheDocument()
  const input = screen.getByLabelText('Name')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAttribute('aria-describedby', 'name-error')
})
