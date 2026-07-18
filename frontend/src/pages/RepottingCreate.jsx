import React, { useEffect, useRef, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { measurementsApi } from '../api/measurements'
import { ApiError } from '../api/client'
import { nowLocalISOFull, toLocalISOFull } from '../utils/datetime.js'
import { useForm, required, minNumber } from '../components/form/useForm.js'
import DateTimeLocal from '../components/form/fields/DateTimeLocal.jsx'
import PlantSelect from '../components/PlantSelect.jsx'
import NumberInput from '../components/form/fields/NumberInput.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'

// Two-state switch for choosing the repotting type.
// Full    = also replaced the soil (fresh soil) -> reset retained water to 0.
// Partial = kept the soil (default)            -> retain its current water.
function RepotTypeSwitch({ value, onChange, disabled = false }) {
  const isFull = value === 'full'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        role="switch"
        aria-checked={isFull}
        aria-disabled={disabled}
        aria-label="Replace soil type and/or volume"
        onClick={() => {
          if (disabled) return
          onChange(isFull ? 'partial' : 'full')
        }}
        style={{
          position: 'relative',
          width: 44,
          height: 24,
          borderRadius: 999,
          border: '1px solid var(--border)',
          background: isFull ? 'var(--button-primary-bg)' : 'var(--surface-2, #e5e7eb)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          padding: 0,
          flex: '0 0 auto',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: isFull ? 22 : 2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </button>
      <div>
        <div style={{ fontWeight: 600 }}>Replace soil type and/or volume</div>
        <div style={{ fontSize: 12, color: 'var(--muted, #6b7280)' }}>
          On: fresh soil — resets retained water to 0. Off: kept soil — retains its current water.
        </div>
      </div>
    </div>
  )
}

const RepottingCreate = () => {
  const [search] = useSearchParams()
  const preselect = search.get('plant')
  const editId = search.get('id')
  const location = useLocation()
  const navigate = useNavigate()

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isEdit = !!editId
  const [smallPotDialogOpen, setSmallPotDialogOpen] = useState(false)
  const [pendingSmallPotConfirm, setPendingSmallPotConfirm] = useState(null)
  const smallPotNoBtnRef = useRef(null)

  const form = useForm({
    plant_id: preselect || '',
    measured_at: nowLocalISOFull(),
    weight_before_repotting_g: '',
    last_wet_weight_g: '',
    repotting_type: 'partial',
    note: '',
  })

  const repotTypeLabel =
    form.values.repotting_type === 'full'
      ? 'Full — reset water to 0'
      : 'Partial — keep current water'

  useEffect(() => {
    let cancelled = false
    async function loadRepottingEvent() {
      if (!isEdit) return
      try {
        const data = await measurementsApi.repotting.get(preselect, editId)
        if (cancelled) return
        form.setValues({
          plant_id: data.plant_id,
          measured_at: toLocalISOFull(data.measured_at),
          weight_before_repotting_g:
            (data.weight_before_repotting_g ?? data.measured_weight_g) != null
              ? String(data.weight_before_repotting_g ?? data.measured_weight_g)
              : '',
          last_wet_weight_g: data.last_wet_weight_g != null ? String(data.last_wet_weight_g) : '',
          // Infer the original repotting type from the repotting row's water_added_g:
          // full resets it to 0, partial carries the previous (>0) value forward.
          repotting_type: data.water_added_g && data.water_added_g > 0 ? 'partial' : 'full',
          note: data.note || '',
        })
      } catch (_) {
        if (!cancelled) setError('Failed to load repotting event')
      }
    }
    loadRepottingEvent()
    return () => {
      cancelled = true
    }
  }, [isEdit, editId])

  useEffect(() => {
    if (preselect && !isEdit) form.setValue('plant_id', preselect)
  }, [preselect, isEdit])

  useEffect(() => {
    if (!smallPotDialogOpen) return
    const t = setTimeout(() => {
      try {
        smallPotNoBtnRef.current?.focus?.()
      } catch {
        // ignore
      }
    }, 0)
    return () => clearTimeout(t)
  }, [smallPotDialogOpen])

  const onSubmit = form.handleSubmit(async (vals) => {
    setSaving(true)
    setError('')
    let payload = null
    try {
      payload = {
        plant_id: vals.plant_id,
        measured_at: vals.measured_at,
        measured_weight_g:
          vals.weight_before_repotting_g !== '' ? Number(vals.weight_before_repotting_g) : null,
        last_wet_weight_g: vals.last_wet_weight_g !== '' ? Number(vals.last_wet_weight_g) : null,
        repotting_type: vals.repotting_type,
        note: vals.note || null,
      }
      if (isEdit) {
        await measurementsApi.repotting.update(vals.plant_id, editId, payload)
      } else {
        await measurementsApi.repotting.create(vals.plant_id, payload)
      }
      const from = location.state?.from
      if (from) navigate(from)
      else navigate(`/plants/${vals.plant_id}`)
    } catch (e) {
      const msg = (e && typeof e === 'object' && (e.detail || e.message)) || ''
      if (
        !isEdit &&
        payload &&
        e instanceof ApiError &&
        e.status === 409 &&
        typeof msg === 'string' &&
        msg.startsWith('Moved to a very small pot?')
      ) {
        setPendingSmallPotConfirm({ plantId: vals.plant_id, payload })
        setSmallPotDialogOpen(true)
        return
      }
      setError((typeof msg === 'string' && msg) || 'Failed to save')
    } finally {
      setSaving(false)
    }
  })

  return (
    <DashboardLayout title={isEdit ? 'Edit Repotting' : 'Repotting'}>
      <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
        <ConfirmDialog
          open={smallPotDialogOpen}
          title="Moved to a very small pot?"
          message={`This pot seems too small for the current water. Continue with your selected repotting type — ${repotTypeLabel}?`}
          tone="warning"
          disabled={saving}
          onCancel={() => {
            // Treat overlay click / Escape as "No".
            setSmallPotDialogOpen(false)
            setPendingSmallPotConfirm(null)
            setError('')
          }}
          // ConfirmDialog styles the confirm button as primary by default.
          // Override buttons so "No" is black/primary and "Yes" is white/secondary.
          buttons={[
            {
              key: 'no',
              text: 'No',
              ref: smallPotNoBtnRef,
              disabled: saving,
              style: {
                padding: '8px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                background: 'var(--button-primary-bg)',
                border: '1px solid var(--button-primary-bg)',
                color: 'var(--button-primary-text)',
              },
              onClick: () => {
                setSmallPotDialogOpen(false)
                setPendingSmallPotConfirm(null)
                setError('')
              },
            },
            {
              key: 'yes',
              text: 'Yes',
              disabled: saving,
              style: {
                padding: '8px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                background: 'var(--button-secondary-bg)',
                border: '1px solid var(--border)',
                color: 'var(--button-secondary-text)',
              },
              onClick: async () => {
                if (!pendingSmallPotConfirm) return
                setSaving(true)
                setError('')
                try {
                  await measurementsApi.repotting.create(pendingSmallPotConfirm.plantId, {
                    ...pendingSmallPotConfirm.payload,
                    confirm_small_pot: true,
                  })
                  setSmallPotDialogOpen(false)
                  setPendingSmallPotConfirm(null)
                  const from = location.state?.from
                  if (from) navigate(from)
                  else navigate(`/plants/${pendingSmallPotConfirm.plantId}`)
                } catch (e) {
                  const msg = (e && typeof e === 'object' && (e.detail || e.message)) || ''
                  setSmallPotDialogOpen(false)
                  setPendingSmallPotConfirm(null)
                  setError((typeof msg === 'string' && msg) || 'Failed to save')
                } finally {
                  setSaving(false)
                }
              },
            },
          ]}
          onConfirm={() => {}}
        />
        {error && <div style={{ color: 'tomato', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <PlantSelect
            form={form}
            name="plant_id"
            label="Plant"
            required
            validators={[required()]}
            disabled={isEdit}
          />
          <DateTimeLocal
            form={form}
            name="measured_at"
            label="Measured at"
            required
            validators={[required()]}
          />
          <NumberInput
            form={form}
            name="weight_before_repotting_g"
            label="Weight before repotting (g)"
            min={0}
            validators={[minNumber(0)]}
          />
          <NumberInput
            form={form}
            name="last_wet_weight_g"
            label="Weight after repotting (g)"
            min={0}
            validators={[minNumber(0)]}
          />
          <div style={{ gridColumn: '1 / -1' }}>
            <RepotTypeSwitch
              value={form.values.repotting_type}
              onChange={(v) => form.setValue('repotting_type', v)}
              disabled={isEdit}
            />
            {isEdit && (
              <div style={{ fontSize: 12, color: 'var(--muted, #6b7280)', marginTop: 4 }}>
                Repotting type is fixed after creation and cannot be changed. <br />Delete (optionally) all 3 measurements of this repotting and/or create a new
                one if the soil type/volume changed.
              </div>
            )}
          </div>
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
          <button
            disabled={!form.valid || !form.values.plant_id || saving}
            type="submit"
            className="btn btn-primary"
          >
            {isEdit ? 'Update repotting' : 'Save repotting'}
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
    </DashboardLayout>
  )
}

export default RepottingCreate
