import React, { useState } from 'react'
import Select from './Select.jsx'

function useMockForm({ initial = '', initialError = '' } = {}) {
  const [value, setValue] = useState(initial)
  const [errors, setErrors] = useState(initialError ? { sel: initialError } : {})
  return {
    get errors() { return errors },
    register(field) {
      return {
        name: field,
        value,
        onChange: (e) => setValue(e.target.value),
      }
    },
    setError(msg) { setErrors(msg ? { sel: msg } : {}) },
  }
}

export default {
  title: 'Form/Fields/Select',
  component: Select,
  args: {
    name: 'sel',
    label: 'Choose one',
    disabled: false,
    required: false,
    error: '',
    defaultValue: 'b',
  },
  argTypes: {
    error: { control: 'text' },
    defaultValue: { control: 'text' },
  }
}

const Options = () => (
  <>
    <option value="a">A</option>
    <option value="b">B</option>
    <option value="c">C</option>
  </>
)

export const Default = (args) => {
  const form = useMockForm({ initial: args.defaultValue })
  form.setError(args.error)
  return (
    <Select {...args} form={form}>
      <Options />
    </Select>
  )
}

export const WithError = (args) => {
  const form = useMockForm({ initial: args.defaultValue, initialError: 'Please select a value' })
  return (
    <Select {...args} form={form}>
      <Options />
    </Select>
  )
}

export const Disabled = (args) => {
  const form = useMockForm({ initial: 'a' })
  return (
    <Select {...args} form={form} disabled>
      <Options />
    </Select>
  )
}
