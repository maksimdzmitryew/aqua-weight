import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useForm, required, minNumber, maxNumber, optionalHexLen } from '../../../../src/components/form/useForm.js'

describe('src/components/form/useForm.js', () => {
  it('required validator returns true for non-empty and message for empty/null', () => {
    const v = required('Req')
    expect(v('x')).toBe(true)
    expect(v(0)).toBe(true)
    expect(v(false)).toBe(true)
    expect(v('')).toBe('Req')
    expect(v(null)).toBe('Req')
    expect(v(undefined)).toBe('Req')
  })

  it('minNumber covers empty, NaN, below, equal, above', () => {
    const v = minNumber(5, 'gt')
    expect(v('')).toBe(true)
    expect(v(null)).toBe(true)
    expect(v('abc')).toBe('gt')
    expect(v('4')).toBe('gt')
    expect(v(5)).toBe(true)
    expect(v('6')).toBe(true)
  })

  it('maxNumber covers empty, NaN, above, equal, below', () => {
    const v = maxNumber(10, 'lte')
    expect(v('')).toBe(true)
    expect(v(undefined)).toBe(true)
    expect(v('nope')).toBe('lte')
    expect(v(11)).toBe('lte')
    expect(v(10)).toBe(true)
    expect(v('9')).toBe(true)
  })

  it('optionalHexLen allows empty and validates exact length hex', () => {
    const v = optionalHexLen(6, 'hex6')
    expect(v('')).toBe(true)
    expect(v(null)).toBe(true)
    expect(v('a1b2c')).toBe('hex6')
    expect(v('zzzzzz')).toBe('hex6')
    expect(v('a1B2c3')).toBe(true)
  })

  it('optionalHexLen uses default message when custom not provided', () => {
    const v = optionalHexLen(4)
    // invalid length -> default message
    expect(v('abcd1')).toBe('Must be 4-char hex')
  })

  it('useForm manages values, touched, errors via register onChange/onBlur and validateAll', async () => {
    const { result } = renderHook(() => useForm({ a: '', b: false }))

    // register fields with validators and exercise default values/checked
    let regA, regB
    act(() => {
      regA = result.current.register('a', { validators: [required(), minNumber(2)] })
      regB = result.current.register('b', { type: 'checkbox', validators: [required()] })
    })

    // Defaults
    expect(regA.value).toBe('')
    // For checkbox, implementation provides checked and value reflects current state (false)
    expect(regB.value).toBe(false)
    expect(regB.checked).toBe(false)

    // onBlur validates and marks touched
    act(() => {
      regA.onBlur()
    })
    expect(result.current.touched.a).toBe(true)
    expect(result.current.errors.a).toBe('Required')

    // Re-register to capture updated touched/values in closure (register is memoized on [touched, values])
    act(() => {
      regA = result.current.register('a', { validators: [required(), minNumber(2)] })
    })

    // onChange updates value and re-validates when already touched
    act(() => {
      regA.onChange({ target: { value: '1', type: 'text' } })
    })
    expect(result.current.values.a).toBe('1')
    expect(result.current.errors.a).toBe('Must be >= 2')

    act(() => {
      regA.onChange({ target: { value: '3', type: 'text' } })
    })
    expect(result.current.errors.a).toBe('')

    // onChange with primitive value (no event object)
    act(() => {
      regA.onChange('4')
    })
    expect(result.current.values.a).toBe('4')

    // Checkbox change uses checked
    act(() => {
      regB.onBlur() // touched b
      regB.onChange({ target: { type: 'checkbox', checked: true } })
    })
    expect(result.current.values.b).toBe(true)
    expect(result.current.errors.b).toBe('')

    // validateAll aggregates (no errors now)
    act(() => {
      const errs = result.current.validateAll()
      expect(errs).toEqual({})
    })
  })

  it('covers empty validators path and default Invalid value from non-string validator result', () => {
    const { result } = renderHook(() => useForm({ x: 'init' }))

    let noVal, badVal
    act(() => {
      // no validators registered
      noVal = result.current.register('nv')
      // validator that returns a non-string falsey to trigger default message
      badVal = result.current.register('bad', { validators: [() => false] })
    })

    act(() => {
      noVal.onBlur()
      badVal.onBlur()
    })

    expect(result.current.errors.nv).toBe('') // empty validators -> no error
    expect(result.current.errors.bad).toBe('Invalid value')
  })

  it('validateAll covers keys present only in values and only in validators', () => {
    const { result } = renderHook(() => useForm({ onlyValues: '' }))
    // Register a field that is not in initial values
    act(() => {
      result.current.register('onlyValidators', { validators: [required()] })
    })

    act(() => {
      const errs = result.current.validateAll()
      // onlyValues had no validators -> no error entry
      expect(errs.onlyValues).toBeUndefined()
      // onlyValidators should be validated and produce error
      expect(errs.onlyValidators).toBe('Required')
    })
  })

  it('setValue/setValues update values and dirty reflects changes vs initials', () => {
    const { result } = renderHook(() => useForm({ x: 1 }))
    expect(result.current.dirty).toBe(false)

    act(() => {
      result.current.setValue('x', 2)
    })
    expect(result.current.values.x).toBe(2)
    expect(result.current.dirty).toBe(true)

    act(() => {
      result.current.setValues({ x: 1, y: 3 })
    })
    expect(result.current.values).toEqual({ x: 1, y: 3 })
    // still dirty because new key y was not in initials
    expect(result.current.dirty).toBe(true)
  })

  it('handleSubmit prevents default, stops on errors, and calls callback with values when valid (async OK)', async () => {
    const { result } = renderHook(() => useForm({ n: '' }))
    // set up a validator that fails until value is set
    let reg
    act(() => {
      reg = result.current.register('n', { validators: [required()] })
    })

    const fn = vi.fn(async () => {
      // simulate async action
      await new Promise((r) => setTimeout(r, 0))
    })
    const prevent = vi.fn()

    // First submit should not call fn due to error
    await act(async () => {
      await result.current.handleSubmit(fn)({ preventDefault: prevent })
    })
    expect(prevent).toHaveBeenCalledTimes(1)
    expect(fn).not.toHaveBeenCalled()

    // Fix value and submit again
    act(() => {
      reg.onChange({ target: { value: 'ok', type: 'text' } })
    })
    await act(async () => {
      await result.current.handleSubmit(fn)({ preventDefault: prevent })
    })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toEqual({ n: 'ok' })
    // valid flag reflects no errors
    expect(result.current.valid).toBe(true)
  })
})
