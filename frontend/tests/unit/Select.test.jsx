import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../../src/ThemeContext.jsx'
import Select from '../../src/components/form/fields/Select.jsx'

function makeForm({ defaultValue = '', error = '' } = {}) {
  const state = { value: defaultValue, errors: error ? { sel: error } : {} }
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

test('renders select with label and options', () => {
  const form = makeForm({ defaultValue: 'b' })
  renderWithTheme(
    <Select form={form} name="sel" label="Choose one">
      <option value="a">A</option>
      <option value="b">B</option>
    </Select>
  )
  const select = screen.getByLabelText('Choose one')
  expect(select).toBeInTheDocument()
  expect(select).toHaveDisplayValue('B')
})

test('changes selection on user action', async () => {
  const user = userEvent.setup()
  const form = makeForm({ defaultValue: 'a' })
  renderWithTheme(
    <Select form={form} name="sel" label="Choose one">
      <option value="a">A</option>
      <option value="b">B</option>
    </Select>
  )
  const select = screen.getByLabelText('Choose one')
  await user.selectOptions(select, 'b')
  expect(form.value).toBe('b')
})

test('shows error and accessibility attributes', () => {
  const form = makeForm({ error: 'Please select a value' })
  renderWithTheme(
    <Select form={form} name="sel" label="Choose one">
      <option value="a">A</option>
    </Select>
  )
  expect(screen.getByText('Please select a value')).toBeInTheDocument()
  const select = screen.getByLabelText('Choose one')
  expect(select).toHaveAttribute('aria-invalid', 'true')
  expect(select).toHaveAttribute('aria-describedby', 'sel-error')
})
