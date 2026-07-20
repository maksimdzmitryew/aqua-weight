import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { measurementsApi } from '../api/measurements'
import { plantsApi } from '../api/plants'
import { nowLocalISOFull, toLocalISOFull } from '../utils/datetime.js'
import { useForm, required, minNumber } from '../components/form/useForm.js'
import DateTimeLocal from '../components/form/fields/DateTimeLocal.jsx'
import PlantSelect from '../components/PlantSelect.jsx'
import NumberInput from '../components/form/fields/NumberInput.jsx'

export default function WateringCreate() {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
  const editId = search.get('id')
  const isEdit = !!editId
  const location = useLocation()
  const navigate = useNavigate()

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [isVacationSignature, setIsVacationSignature] = useState(false)
  const [plant, setPlant] = useState(null)
  const [overwaterPrompt, setOverwaterPrompt] = useState(null)

  const operationMode =
    typeof localStorage !== 'undefined' ? localStorage.getItem('operationMode') : 'manual'

  const form = useForm({
    plant_id: preselect || '',
    measured_at: nowLocalISOFull(),
    last_dry_weight_g: '',
    last_wet_weight_g: '',
    water_added_g: '',
    note: '',
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
        const data = await measurementsApi.getById(preselect, editId)
        if (cancelled) return
        const measured_at = data?.measured_at
          ? toLocalISOFull(data.measured_at) || form.values.measured_at
          : form.values.measured_at

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
          note: data?.note || '',
        })
      } catch (_) {
        // ignore
      }
    }
    loadExisting()
    return () => {
      cancelled = true
    }
  }, [isEdit, editId])

  // Load the selected plant's capacity (min/max water) so the UC1 over-capacity
  // check can evaluate the entered wet weight.
  useEffect(() => {
    let cancelled = false
    const pid = form.values.plant_id
    if (!pid) {
      setPlant(null)
      return
    }
    plantsApi
      .getByUuid(pid)
      .then((p) => {
        if (!cancelled) setPlant(p)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [form.values.plant_id])

  // Persist a watering event. Extracted from onSubmit so the UC1 modal can defer the
  // save until the user answers the prompt.
  async function saveWatering(vals) {
    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        // When editing, if it's a Vacation signature, we must send nulls for weights
        const payload = {
          measured_at: vals.measured_at,
          last_dry_weight_g: isVacationSignature
            ? null
            : vals.last_dry_weight_g !== ''
              ? Number(vals.last_dry_weight_g)
              : null,
          last_wet_weight_g: isVacationSignature
            ? null
            : vals.last_wet_weight_g !== ''
              ? Number(vals.last_wet_weight_g)
              : null,
          water_added_g: isVacationSignature
            ? null
            : vals.water_added_g !== ''
              ? Number(vals.water_added_g)
              : null,
          note: vals.note || null,
        }
        await measurementsApi.watering.update(vals.plant_id, editId, payload)
      } else {
        // Adding new
        if (operationMode === 'vacation') {
          await measurementsApi.watering.createVacation(vals.plant_id, {
            measured_at: vals.measured_at,
          })
        } else {
          const payload = {
            measured_at: vals.measured_at,
            last_dry_weight_g:
              vals.last_dry_weight_g !== '' ? Number(vals.last_dry_weight_g) : null,
            last_wet_weight_g:
              vals.last_wet_weight_g !== '' ? Number(vals.last_wet_weight_g) : null,
            water_added_g: vals.water_added_g !== '' ? Number(vals.water_added_g) : null,
            note: vals.note || null,
          }
          await measurementsApi.watering.create(vals.plant_id, payload)
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
  }

  // UC1: if the entered wet weight exceeds the plant's saturated capacity, defer the
  // save behind the "Risk of Root Rot Warning" modal. `p` is the loaded plant (passed
  // in so the decision never depends on possibly-stale closure state).
  function shouldPromptOverwater(vals, p) {
    const wet = Number(vals.last_wet_weight_g)
    const minDry = Number(p?.min_dry_weight_g)
    const maxWater = Number(p?.max_water_weight_g)
    return p && minDry > 0 && maxWater > 0 && !Number.isNaN(wet) && wet > minDry + maxWater
  }

  const onSubmit = form.handleSubmit(async (vals) => {
    // UC1 needs the plant's saturated capacity. If the plant was just selected and its
    // capacity hasn't loaded yet (e.g. the user submits quickly), fetch it now instead
    // of silently skipping the overwater warning.
    let capacityPlant = plant
    if (vals.plant_id && !capacityPlant) {
      try {
        capacityPlant = await plantsApi.getByUuid(vals.plant_id)
        setPlant(capacityPlant)
      } catch {
        capacityPlant = null
      }
    }
    if (shouldPromptOverwater(vals, capacityPlant)) {
      setOverwaterPrompt({ vals })
      return
    }
    await saveWatering(vals)
  })

  // UC1 "No": the soil legitimately holds more water than we thought. Recalibrate
  // max_water_weight_g = entered wet weight - min dry weight, persist it, then record
  // the watering. If the PATCH fails, abort both (do not submit).
  async function handleNoRecalibrate(vals) {
    const wet = Number(vals.last_wet_weight_g)
    const newMax = Math.round(wet - Number(plant?.min_dry_weight_g))
    const uuid = plant?.uuid || vals.plant_id
    try {
      await plantsApi.update(uuid, { max_water_weight_g: newMax })
    } catch (e) {
      setError(e.message || 'Failed to recalibrate max water')
      return
    }
    setPlant((p) => (p ? { ...p, max_water_weight_g: newMax } : p))
    await saveWatering(vals)
  }

  // Determine if weight fields should be visible
  const showWeightFields = isEdit ? !isVacationSignature : operationMode !== 'vacation'

  return (
    <DashboardLayout title={isEdit ? 'Edit Watering' : 'Watering'}>
      <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
        {error && <div style={{ color: 'tomato', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <DateTimeLocal
            form={form}
            name="measured_at"
            label="Measured at"
            required
            validators={[required()]}
          />
          <PlantSelect
            form={form}
            name="plant_id"
            label="Plant"
            required
            validators={[required()]}
            disabled={isEdit}
          />
          {showWeightFields && (
            <>
              <NumberInput
                form={form}
                name="last_wet_weight_g"
                label="Current weight (g)"
                min={0}
                validators={[minNumber(0)]}
              />
              <NumberInput
                form={form}
                name="last_dry_weight_g"
                label="[optional] Weight before watering (g)"
                min={0}
                validators={[minNumber(0)]}
              />
              <div />
              <NumberInput
                form={form}
                name="water_added_g"
                label="[optional] Water added (g)"
                min={0}
                validators={[minNumber(0)]}
              />
            </>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="note" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Note
            </label>
            <textarea
              id="note"
              {...form.register('note')}
              className="input"
              style={{ height: 100 }}
            />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button disabled={!form.valid || saving} type="submit" className="btn btn-primary">
            {isEdit ? 'Update watering' : 'Save watering'}
          </button>
          <button
            type="button"
            onClick={() => (location.state?.from ? navigate(location.state.from) : navigate(-1))}
            className="btn btn-secondary"
            style={{ marginLeft: 8 }}
          >
            Cancel
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={!!overwaterPrompt}
        title="Risk of Root Rot Warning"
        tone="warning"
        defaultFocus="confirm"
        confirmText="Yes"
        cancelText="No"
        message={
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Did you just overwater?</div>
            <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
              Current weight indicates the soil retains historical maximum of water. It might mean
              the roots did not dry enough, or are clogged with water because soil is too wet.
              Answer 'No' if you are sure you did not water enough previously.
            </div>
          </div>
        }
        onConfirm={() => {
          if (!overwaterPrompt) return
          const { vals } = overwaterPrompt
          setOverwaterPrompt(null)
          saveWatering(vals)
        }}
        onCancel={() => {
          if (!overwaterPrompt) return
          const { vals } = overwaterPrompt
          setOverwaterPrompt(null)
          handleNoRecalibrate(vals)
        }}
        onClose={() => setOverwaterPrompt(null)}
      />
    </DashboardLayout>
  )
}
