import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTheme } from '../ThemeContext.jsx'
import { measurementsApi } from '../api/measurements'
import { nowLocalISOMinutes, toLocalISOMinutes } from '../utils/datetime.js'
import { useForm, required, minNumber } from '../components/form/useForm.js'
import DateTimeLocal from '../components/form/fields/DateTimeLocal.jsx'
import PlantSelect from '../components/PlantSelect.jsx'
import NumberInput from '../components/form/fields/NumberInput.jsx'

export default function WateringCreate() {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
  const editId = search.get('id')
  const isEdit = !!editId
  const location = useLocation();
  const navigate = useNavigate()
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [isVacationSignature, setIsVacationSignature] = useState(false)

  const operationMode = typeof localStorage !== 'undefined' ? localStorage.getItem('operationMode') : 'manual'

  const form = useForm({
    plant_id: preselect || '',
    measured_at: nowLocalISOMinutes(),
    last_dry_weight_g: '',
    last_wet_weight_g: '',
    water_added_g: '',
  })

  useEffect(() => {
    if (preselect && !isEdit) form.setValue('plant_id', preselect)
  }, [preselect, isEdit])

  // Load existing watering in edit mode (reuse this page for add/edit)
  useEffect(() => {
    let cancelled = false
    async function loadExisting() {
      if (!isEdit) return
      try {
        const data = await measurementsApi.getById(editId)
        if (cancelled) return
        const measured_at = data?.measured_at ? toLocalISOMinutes(data.measured_at) || form.values.measured_at : form.values.measured_at
        
        // Detection: if both weights are NULL, it's a Vacation/Reported signature
        const isVac = data?.last_dry_weight_g === null && data?.last_wet_weight_g === null
        setIsVacationSignature(isVac)

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
      if (isEdit) {
        // When editing, if it's a Vacation signature, we must send nulls for weights
        const payload = {
          measured_at: vals.measured_at,
          last_dry_weight_g: isVacationSignature ? null : (vals.last_dry_weight_g !== '' ? Number(vals.last_dry_weight_g) : null),
          last_wet_weight_g: isVacationSignature ? null : (vals.last_wet_weight_g !== '' ? Number(vals.last_wet_weight_g) : null),
          water_added_g: isVacationSignature ? null : (vals.water_added_g !== '' ? Number(vals.water_added_g) : null),
        }
        await measurementsApi.watering.update(editId, payload)
      } else {
        // Adding new
        if (operationMode === 'vacation') {
          await measurementsApi.watering.createVacation({
            plant_id: vals.plant_id,
            measured_at: vals.measured_at,
          })
        } else {
          const payload = {
            plant_id: vals.plant_id,
            measured_at: vals.measured_at,
            last_dry_weight_g: vals.last_dry_weight_g !== '' ? Number(vals.last_dry_weight_g) : null,
            last_wet_weight_g: vals.last_wet_weight_g !== '' ? Number(vals.last_wet_weight_g) : null,
            water_added_g: vals.water_added_g !== '' ? Number(vals.water_added_g) : null,
          }
          await measurementsApi.watering.create(payload)
        }
      }
      const from = location.state?.from
      if (from) navigate(from)
      else navigate(`/plants/${vals.plant_id}`)
    } catch (e) {
      setError(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  })

  // Determine if weight fields should be visible
  const showWeightFields = isEdit ? !isVacationSignature : operationMode !== 'vacation'

  return (
    <DashboardLayout title={isEdit ? 'Edit Watering' : 'Watering'}>
      <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
        {error && <div style={{ color: 'tomato', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <DateTimeLocal form={form} name="measured_at" label="Measured at" required validators={[required()]} />
          <PlantSelect form={form} name="plant_id" label="Plant" required validators={[required()]} disabled={isEdit} />
          {showWeightFields && (
            <>
              <NumberInput form={form} name="last_wet_weight_g" label="Current weight (g)" min={0} validators={[minNumber(0)]} />
              <NumberInput form={form} name="last_dry_weight_g" label="[optional] Weight before watering (g)" min={0} validators={[minNumber(0)]} />
              <div />
              <NumberInput form={form} name="water_added_g" label="[optional] Water added (g)" min={0} validators={[minNumber(0)]} />
            </>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <button disabled={!form.valid || saving} type="submit" className="btn btn-primary">{isEdit ? 'Update watering' : 'Save watering'}</button>
          <button type="button" onClick={() => location.state?.from ? navigate(location.state.from) : navigate(-1)} className="btn btn-secondary" style={{ marginLeft: 8 }}>Cancel</button>
        </div>
      </form>
    </DashboardLayout>
  )
}
