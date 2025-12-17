import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../src/ThemeContext.jsx'
import NumberInput from '../../src/components/form/fields/NumberInput.jsx'

function makeForm({ defaultValue = '', error = '' } = {}) {
  const state = { value: defaultValue, errors: error ? { qty: error } : {} }
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

test('renders number input with label', () => {
  const form = makeForm()
  renderWithTheme(<NumberInput form={form} name="qty" label="Quantity" min={0} max={10} step={1} />)
  const input = screen.getByLabelText('Quantity')
  expect(input).toHaveAttribute('type', 'number')
  expect(input).toHaveAttribute('min', '0')
  expect(input).toHaveAttribute('max', '10')
  expect(input).toHaveAttribute('step', '1')
})

test('accepts typing numeric value', async () => {
  const user = userEvent.setup()
  const form = makeForm()
  renderWithTheme(<NumberInput form={form} name="qty" label="Quantity" />)
  const input = screen.getByLabelText('Quantity')
  await user.clear(input)
  await user.type(input, '2')
  expect(form.value).toBe('2')
})

test('respects required and disabled props', () => {
  const form = makeForm()
  renderWithTheme(<NumberInput form={form} name="qty" label="Quantity" required disabled />)
  const input = screen.getByLabelText('Quantity')
  expect(input).toBeRequired()
  expect(input).toBeDisabled()
})

test('shows error message and aria attributes', () => {
  const form = makeForm({ error: 'Invalid number' })
  renderWithTheme(<NumberInput form={form} name="qty" label="Quantity" />)
  expect(screen.getByText('Invalid number')).toBeInTheDocument()
  const input = screen.getByLabelText('Quantity')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAttribute('aria-describedby', 'qty-error')
})
