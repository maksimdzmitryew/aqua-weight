import { useCallback, useMemo, useRef, useState } from 'react'

// Basic validators helpers
export function required(msg = 'Required') {
  return (v) => {
    const ok = !(v === '' || v == null)
    return ok || msg
  }
}

export function minNumber(min, msg) {
  return (v) => {
    if (v === '' || v == null) return true
    const num = Number(v)
    if (Number.isNaN(num)) return msg || 'Must be a number'
    return num >= min || (msg || `Must be >= ${min}`)
  }
}

export function maxNumber(max, msg) {
  return (v) => {
    if (v === '' || v == null) return true
    const num = Number(v)
    if (Number.isNaN(num)) return msg || 'Must be a number'
    return num <= max || (msg || `Must be <= ${max}`)
  }
}

export function optionalHexLen(len, msg) {
  const re = new RegExp(`^[0-9a-fA-F]{${len}}$`)
  return (v) => {
    if (!v) return true
    return re.test(String(v)) || (msg || `Must be ${len}-char hex`)
  }
}

function runValidators(value, validators) {
  if (!validators || validators.length === 0) return ''
  for (const fn of validators) {
    const res = fn(value)
    if (res !== true) return typeof res === 'string' ? res : 'Invalid value'
  }
  return ''
}

export function useForm(initials = {}) {
  const initialRef = useRef({ ...initials })
  const [values, setValues] = useState({ ...initials })
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const validatorsRef = useRef({})

  const setValue = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  const setAllValues = useCallback((next) => {
    setValues({ ...next })
  }, [])

  const register = useCallback((name, opts = {}) => {
    if (!(name in validatorsRef.current)) {
      validatorsRef.current[name] = opts.validators || []
    }
    return {
      name,
      value: values[name] ?? (opts.type === 'checkbox' ? false : ''),
      checked: opts.type === 'checkbox' ? !!values[name] : undefined,
      onChange: (e) => {
        const target = e?.target
        const v = target ? (target.type === 'checkbox' ? target.checked : target.value) : e
        setValues((prev) => ({ ...prev, [name]: v }))
        if (touched[name]) {
          const err = runValidators(v, validatorsRef.current[name])
          setErrors((prev) => ({ ...prev, [name]: err }))
        }
      },
      onBlur: () => {
        setTouched((prev) => ({ ...prev, [name]: true }))
        const v = values[name]
        const err = runValidators(v, validatorsRef.current[name])
        setErrors((prev) => ({ ...prev, [name]: err }))
      },
    }
  }, [touched, values])

  const validateAll = useCallback(() => {
    const nextErrors = {}
    for (const name of Object.keys({ ...values, ...validatorsRef.current })) {
      const err = runValidators(values[name], validatorsRef.current[name] || [])
      if (err) nextErrors[name] = err
    }
    setErrors(nextErrors)
    return nextErrors
  }, [values])

  const handleSubmit = useCallback((fn) => {
    return async (e) => {
      e?.preventDefault?.()
      const errs = validateAll()
      const has = Object.values(errs).some(Boolean)
      if (has) return
      await fn({ ...values })
    }
  }, [validateAll, values])

  const dirty = useMemo(() => {
    const a = initialRef.current
    const b = values
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if (a[k] !== b[k]) return true
    }
    return false
  }, [values])

  const valid = useMemo(() => Object.values(errors).every((e) => !e), [errors])

  return {
    values,
    errors,
    touched,
    dirty,
    valid,
    setValue,
    setValues: setAllValues,
    register,
    handleSubmit,
    validateAll,
  }
}
