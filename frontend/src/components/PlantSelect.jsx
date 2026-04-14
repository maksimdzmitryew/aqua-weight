import React, { useEffect, useState } from 'react'
import Select from './form/fields/Select.jsx'
import { plantsApi } from '../api/plants'

/**
 * PlantSelect - Dropdown component for selecting plants
 *
 * Fetches only plant names (uuid, name) from backend to minimize data transfer.
 * Uses the lightweight /api/plants/names endpoint.
 *
 * @param {Object} props
 * @param {Object} props.form - Form object from useForm hook
 * @param {string} props.name - Field name
 * @param {string} props.label - Field label
 * @param {boolean} props.required - Is field required
 * @param {boolean} props.disabled - Is field disabled
 * @param {Array} props.validators - Field validators
 */
export default function PlantSelect({ form, name, label, required, disabled, validators, ...rest }) {
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadPlantNames() {
      try {
        setLoading(true)
        setError('')
        const data = await plantsApi.listNames(controller.signal)
        setPlants(Array.isArray(data) ? data : [])
      } catch (e) {
        const msg = e?.message || ''
        const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
        if (!isAbort) {
          setError('Failed to load plants')
        }
      } finally {
        setLoading(false)
      }
    }

    loadPlantNames()
    return () => controller.abort()
  }, [])

  return (
    <div>
      <Select
        form={form}
        name={name}
        label={label}
        required={required}
        disabled={disabled || loading}
        validators={validators}
        {...rest}
      >
        <option value="">
          {loading ? 'Loading plants...' : error ? 'Error loading plants' : 'Select plant...'}
        </option>
        {plants.map(p => (
          <option key={p.uuid} value={p.uuid}>
            {p.name}
          </option>
        ))}
      </Select>
      {error && !loading && (
        <div style={{ color: 'crimson', marginTop: 4, fontSize: 12 }}>
          {error}
        </div>
      )}
    </div>
  )
}
