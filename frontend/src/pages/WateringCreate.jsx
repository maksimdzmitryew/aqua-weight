import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTheme } from '../ThemeContext.jsx'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'
import { nowLocalISOMinutes } from '../utils/datetime.js'
import { useForm, required, minNumber } from '../components/form/useForm.js'
import DateTimeLocal from '../components/form/fields/DateTimeLocal.jsx'
import Select from '../components/form/fields/Select.jsx'
import NumberInput from '../components/form/fields/NumberInput.jsx'

export default function WateringCreate() {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
  const editId = search.get('id')
  const isEdit = !!editId
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [plants, setPlants] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const form = useForm({
    plant_id: preselect || '',
    measured_at: nowLocalISOMinutes(),
    last_dry_weight_g: '',
    last_wet_weight_g: '',
    water_added_g: '',
  })

  useEffect(() => {
    let cancelled = false
    async function loadPlants() {
      try {
        const data = await plantsApi.list()
        if (!cancelled) setPlants(Array.isArray(data) ? data : [])
      } catch (_) {
        if (!cancelled) setError('Failed to load plants')
      }
    }
    loadPlants()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (preselect) form.setValue('plant_id', preselect)
  }, [preselect])

  // Load existing watering in edit mode (reuse this page for add/edit)
  useEffect(() => {
    let cancelled = false
    async function loadExisting() {
      if (!isEdit) return
      try {
        const data = await measurementsApi.getById(editId)
        if (cancelled) return
        const measured_at = data?.measured_at ? String(data.measured_at).replace(' ', 'T').slice(0, 16) : form.values.measured_at
        form.setValues({
          ...form.values,
          plant_id: data?.plant_id || form.values.plant_id,
          measured_at,
          last_dry_weight_g: data?.last_dry_weight_g != null ? String(data.last_dry_weight_g) : '',
          last_wet_weight_g: data?.last_wet_weight_g != null ? String(data.last_wet_weight_g) : '',
          water_added_g: data?.water_added_g != null ? String(data.water_added_g) : '',
        })
      } catch (_) {
        // ignore
      }
    }
    loadExisting()
    return () => { cancelled = true }
  }, [isEdit, editId])

  const onSubmit = form.handleSubmit(async (vals) => {
    setSaving(true)
    setError('')
    try {
      const common = {
        measured_at: vals.measured_at,
        last_dry_weight_g: vals.last_dry_weight_g !== '' ? Number(vals.last_dry_weight_g) : null,
        last_wet_weight_g: vals.last_wet_weight_g !== '' ? Number(vals.last_wet_weight_g) : null,
        water_added_g: vals.water_added_g !== '' ? Number(vals.water_added_g) : null,
      }
      const payload = isEdit ? common : { plant_id: vals.plant_id, ...common }
      if (isEdit) {
        await measurementsApi.watering.update(editId, payload)
      } else {
        await measurementsApi.watering.create(payload)
      }
      navigate(`/plants/${vals.plant_id}`)
    } catch (e) {
      setError(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  })

  return (
    <DashboardLayout title={isEdit ? 'Edit Watering' : 'Watering'}>
      <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
        {error && <div style={{ color: 'tomato', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <DateTimeLocal form={form} name="measured_at" label="Measured at" required validators={[required()]} />
          <Select form={form} name="plant_id" label="Plant" required validators={[required()]} disabled={isEdit}>
            <option value="">Select plant…</option>
            {plants.map(p => (
              <option key={p.uuid} value={p.uuid}>{p.name}</option>
            ))}
          </Select>
          <NumberInput form={form} name="last_wet_weight_g" label="Current weight (g)" min={0} validators={[minNumber(0)]} />
          <NumberInput form={form} name="last_dry_weight_g" label="[optional] Weight before watering (g)" min={0} validators={[minNumber(0)]} />
          <div />
          <NumberInput form={form} name="water_added_g" label="[optional] Water added (g)" min={0} validators={[minNumber(0)]} />
        </div>
        <div style={{ marginTop: 16 }}>
          <button disabled={!form.valid || saving} type="submit" style={{ padding: '8px 14px', borderRadius: 6 }}>{isEdit ? 'Update watering' : 'Save watering'}</button>
          <button type="button" onClick={()=>navigate(document.referrer)} style={{ marginLeft: 8, padding: '8px 14px', borderRadius: 6 }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}
