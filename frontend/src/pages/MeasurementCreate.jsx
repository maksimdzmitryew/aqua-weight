import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTheme } from '../ThemeContext.jsx'
import { plantsApi } from '../api/plants'
import { measurementsApi } from '../api/measurements'
import { nowLocalISOMinutes } from '../utils/datetime.js'
import { useForm, required, minNumber, optionalHexLen } from '../components/form/useForm.js'
import DateTimeLocal from '../components/form/fields/DateTimeLocal.jsx'
import Select from '../components/form/fields/Select.jsx'
import NumberInput from '../components/form/fields/NumberInput.jsx'
import Checkbox from '../components/form/fields/Checkbox.jsx'
import TextInput from '../components/form/fields/TextInput.jsx'

export default function MeasurementCreate() {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
  const editId = search.get('id')
  const location = useLocation();
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [plants, setPlants] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isEdit = !!editId

  const form = useForm({
    plant_id: preselect || '',
    measured_at: nowLocalISOMinutes(),
    measured_weight_g: '',
    method_id: '',
    use_last_method: true,
    scale_id: '',
    note: '',
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

  // Load existing measurement in edit mode
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
          measured_weight_g: data?.measured_weight_g != null ? String(data.measured_weight_g) : '',
          method_id: data?.method_id || '',
          use_last_method: data?.use_last_method != null ? !!data.use_last_method : true,
          scale_id: data?.scale_id || '',
          note: data?.note != null ? String(data.note) : '',
        })
      } catch (_) {
        // ignore for now
      }
    }
    loadExisting()
    return () => { cancelled = true }
  }, [isEdit, editId])

  const onSubmit = form.handleSubmit(async (vals) => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        plant_id: vals.plant_id,
        measured_at: vals.measured_at,
        measured_weight_g: vals.measured_weight_g !== '' ? Number(vals.measured_weight_g) : null,
        method_id: vals.method_id || null,
        use_last_method: !!vals.use_last_method,
        scale_id: vals.scale_id || null,
        note: vals.note || null,
      }
      if (isEdit) {
        await measurementsApi.weight.update(editId, payload)
      } else {
        await measurementsApi.weight.create(payload)
      }
      const from = location.state?.from;
      if (from) navigate(from);
      else navigate(-1); // fallback to browser history
    } catch (e) {
      setError(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  })

  return (
    <DashboardLayout title={isEdit ? 'Edit Measurement' : 'New Measurement'}>
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
          <NumberInput form={form} name="measured_weight_g" label="Measured weight (g)" min={0} validators={[minNumber(0)]} />
          <Checkbox form={form} name="use_last_method" label="Use last method" />
          <div />
          <TextInput form={form} name="method_id" label="Method (optional, hex id)" placeholder="32-char hex" validators={[optionalHexLen(32)]} />
          <div />
          <TextInput form={form} name="scale_id" label="Scale (optional, hex id)" placeholder="32-char hex" validators={[optionalHexLen(32)]} />
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Note</label>
            <textarea {...form.register('note')} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: isDark ? '1px solid #374151' : '1px solid #d1d5db', background: isDark ? '#111827' : '#fff', color: isDark ? '#e5e7eb' : '#111827', height: 100 }} />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button disabled={!form.valid || saving} type="submit" style={{ padding: '8px 14px', borderRadius: 6 }}>{isEdit ? 'Update measurement' : 'Save measurement'}</button>
          <button type="button" onClick={()=>navigate('/plants')} style={{ marginLeft: 8, padding: '8px 14px', borderRadius: 6 }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}
