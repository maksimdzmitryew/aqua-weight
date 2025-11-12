import React, { useState } from 'react'
import TextInput from './TextInput.jsx'

function useMockForm({ initial = '', initialError = '' } = {}) {
  const [value, setValue] = useState(initial)
  const [errors, setErrors] = useState(initialError ? { name: initialError } : {})
  return {
    get errors() { return errors },
    register(field) {
      return {
        name: field,
        value,
        onChange: (e) => setValue(e.target.value),
      }
    },
    setError(msg) { setErrors(msg ? { name: msg } : {}) },
  }
}

export default {
  title: 'Form/Fields/TextInput',
  component: TextInput,
  args: {
    name: 'name',
    label: 'Name',
    placeholder: 'Enter name',
    disabled: false,
    required: false,
    error: '',
    defaultValue: '',
  },
  argTypes: {
    error: { control: 'text' },
    defaultValue: { control: 'text' },
  }
}

export const Default = (args) => {
  const form = useMockForm({ initial: args.defaultValue })
  form.setError(args.error)
  return <TextInput {...args} form={form} />
}

export const WithError = (args) => {
  const form = useMockForm({ initial: args.defaultValue, initialError: 'This field is required' })
  return <TextInput {...args} form={form} />
}

export const Disabled = (args) => {
  const form = useMockForm({ initial: 'Read-only' })
  return <TextInput {...args} form={form} disabled />
}
