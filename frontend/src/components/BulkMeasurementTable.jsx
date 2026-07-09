import React from 'react'
import {
  getWaterRetainCellStyle,
  getWaterLossCellStyle as defaultWaterLossCellStyle,
} from '../utils/water_retained_colors.js'
import Badge from './Badge.jsx'
import DateTimeText from './DateTimeText.jsx'
import StatusIcon from './StatusIcon.jsx'
import { checkNeedsWater, getWaterRetainedPct } from '../utils/watering'
import WaterDropIcon from './icons/WaterDropIcon.jsx'
import { useTheme } from '../ThemeContext.jsx'
import PlantsTableBase, { TableHeader } from './PlantsTableBase.jsx'

export default function BulkMeasurementTable({
  plants,
  inputStatus,
  onCommitValue,
  onCommitVacationWatering,
  onDeleteVacationWatering,
  onDeleteWatering,
  measurementIds = {},
  onViewPlant,
  firstColumnLabel = 'New value',
  firstColumnTooltip,
  // Optional override to compute water loss cell style; falls back to design-system default
  waterLossCellStyle,
  // Optional: show Updated column (hidden on small screens)
  showUpdatedColumn = false,
  // Optional: deemphasize predicate to visually soften rows (e.g., above threshold)
  deemphasizePredicate,
  operationMode = 'manual',
  defaultThreshold = 40,
  approximations = {},
  noPlantsMessage = 'No plants found',
  // Which icon takes precedence when both actions are applicable:
  // 'measure' (bulk measurement page) or 'water' (bulk watering page).
  priorityIcon = 'measure',
}) {
  const computeWaterLossStyle = waterLossCellStyle || defaultWaterLossCellStyle

  const renderHeaders = () => (
    <>
      <TableHeader title={firstColumnTooltip} style={{ minWidth: 165 }}>{firstColumnLabel}</TableHeader>
      <TableHeader title="Watering threshold — water when retained ≤ value" style={{ minWidth: 95 }}>Thresh</TableHeader>
      <TableHeader title="Plant name" style={{ minWidth: 190 }}>Name</TableHeader>
      <TableHeader title="Notes" style={{ minWidth: 240 }}>Notes</TableHeader>
      <TableHeader title="Location" className="th hide-column-phone" style={{ minWidth: 90 }}>
        Location
      </TableHeader>
      <TableHeader
        title={
          operationMode === 'vacation'
            ? 'Projected water loss based on frequency (100 - retained %)'
            : 'Water loss of the last water amount added'
        }
        className="th hide-column-phone"
      >
        Water loss
      </TableHeader>
      {showUpdatedColumn && (
        <TableHeader title="Last update time" className="th hide-column-tablet" style={{ minWidth: 100 }}>
          Updated
        </TableHeader>
      )}
    </>
  )

  const renderRow = (p) => {
    const key = p.uuid || p.id
    const approx = approximations[key]
    const needsWater = checkNeedsWater(p)
    const needsMeasure = p.needs_weighing

    const retained = getWaterRetainedPct(p, operationMode, approx)
    const displayRetained = typeof retained === 'number' ? `${retained}%` : retained

    const displayWaterLoss =
      operationMode === 'vacation' && typeof retained === 'number'
        ? 100 - retained
        : p.water_loss_total_pct !== undefined && p.water_loss_total_pct !== null
          ? Math.round(p.water_loss_total_pct)
          : p.water_loss_total_pct

    const displayWaterLossText = typeof displayWaterLoss === 'number' ? `${displayWaterLoss}%` : '—'

    const status = inputStatus[key]
    const mId = measurementIds[key]
    const isSaving = status === 'saving'

    // Icon state machine for mobile icons:
    // - initial (no commit): show the priority icon when both apply, else whichever applies
    // - saving (API in progress): show empty placeholder (hide weight icon)
    // - success (API responded): show water icon if API says needs_water, else empty placeholder
    // - cleared (after delete): re-evaluate from current plant state
    const apiResponded = status === 'success'
    let iconToUse = null
    if (!apiResponded) {
      // Initial state: when both actions apply, priorityIcon wins;
      // otherwise show whichever single action applies.
      const bothApply = needsMeasure && needsWater
      if (bothApply && priorityIcon === 'water') {
        iconToUse = 'water'
      } else if (bothApply) {
        iconToUse = 'measure'
      } else if (needsMeasure) {
        iconToUse = 'measure'
      } else if (needsWater) {
        iconToUse = 'water'
      }
    } else if (apiResponded && needsWater) {
      iconToUse = 'water'
    }

    let dropColor = '#3b82f6' // blue-500
    if (status === 'success' || mId) dropColor = '#10b981' // green-500
    if (status === 'error') dropColor = '#ef4444' // red-500

    return (
      <>
        <td className="td" style={{ width: 200, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {operationMode !== 'vacation' ? (
              <>
                <input
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      const direction = e.shiftKey ? 'previousElementSibling' : 'nextElementSibling'
                      const targetRow = e.currentTarget.closest('tr')[direction]
                      const nextInput = targetRow?.querySelector('input')

                      if (nextInput) {
                        e.preventDefault()
                        nextInput.focus()
                        nextInput.select()
                      }
                    }
                  }}
                  type="number"
                  style={{ width: 80 }}
                  className={`input ${status === 'success' ? 'bg-success' : ''} ${
                    status === 'error' ? 'bg-error' : ''
                  }`}
                  disabled={isSaving}
                  defaultValue={p.current_weight || ''}
                  onBlur={(e) => {
                    if (e.target.value && (p.uuid || p.id))
                      onCommitValue(p.uuid || p.id, e.target.value)
                  }}
                />
                {mId && onDeleteWatering && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => onDeleteWatering(p.uuid, mId)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: isSaving ? 'wait' : 'pointer',
                      padding: '2px 4px',
                      fontSize: 24,
                      color: '#ef4444',
                      fontWeight: 'bold',
                      borderRadius: 4,
                      width: 18,
                      textAlign: 'center',
                    }}
                    className="hover-bg-muted"
                    title="Delete this watering entry"
                    aria-label="Delete watering"
                  >
                    ×
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  if (mId) {
                    onDeleteVacationWatering?.(p.uuid, mId)
                  } else {
                    onCommitVacationWatering?.(p.uuid)
                  }
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: isSaving ? 'wait' : 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 4,
                  transition: 'background 0.2s',
                }}
                className="hover-bg-muted"
                title={mId ? 'Delete vacation watering' : 'Record vacation watering'}
                aria-label={mId ? 'Undo' : 'Mark watered'}
              >
                <WaterDropIcon
                  color={dropColor}
                  size={24}
                  className={isSaving ? 'animate-pulse' : ''}
                />
              </button>
            )}
            <span
              className="mobile-only-icon"
              style={{
                display: 'none',
                // When a measurement exists, the cross-delete button is the spacer —
                // collapse this area to zero so we don't double up gaps.
                // Otherwise reserve one icon-width slot (icon or hidden placeholder).
                minWidth: mId ? 0 : 28,
                ...(iconToUse || mId || needsWater ? {} : { visibility: 'hidden' }),
              }}
            >
              {!mId && (iconToUse === 'water' || (apiResponded && needsWater)) && <StatusIcon type="water" active={true} />}
              {!mId && iconToUse === 'measure' && <StatusIcon type="measure" active={true} />}
            </span>
            {retained !== 'N/A' && (
              <span style={{ fontSize: '0.9em', color: '#6b7280', width: 36, textAlign: 'right', display: 'inline-block' }}>{displayRetained}</span>
            )}
            {operationMode === 'vacation' && approx?.next_watering_at && (
              <span
                style={{
                  fontSize: '0.9em',
                  padding: '2px 4px',
                  borderRadius: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  ...(approx.days_offset < 0
                    ? { background: '#fecaca', color: '#b91c1c' }
                    : { color: '#6b7280' }),
                }}
              >
                <DateTimeText
                  value={approx.first_calculated_at || approx.next_watering_at}
                  mode="daymonth"
                  showTooltip={false}
                />
                {approx.days_offset !== undefined && approx.days_offset !== null && (
                  <span style={{ opacity: 0.8 }}>({approx.days_offset}d)</span>
                )}
              </span>
            )}
            {needsWater && (
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span className="badge-text-desktop">
                  <Badge
                    tone="warning"
                    title={
                      operationMode === 'vacation'
                        ? 'Needs water based on approximation'
                        : 'Needs water based on threshold'
                    }
                  >
                    Needs water
                  </Badge>
                </span>
              </span>
            )}
            {needsMeasure && (
              <span className="badge-text-desktop">
                <Badge tone="info" title="Needs weighing (>18h since last update)">
                  Needs weight
                </Badge>
              </span>
            )}
          </div>
        </td>
        <td className="td" style={{ whiteSpace: 'nowrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {typeof p.recommended_water_threshold_pct === 'number'
              ? `${p.recommended_water_threshold_pct}%`
              : '—'}
            {needsWater && (
              <WaterDropIcon
                color={status === 'error' ? '#ef4444' : '#f97316'} // orange-500 for water icon
                size={16}
                title="Water needed"
              />
            )}
          </span>
        </td>
        <td
          className="td"
          style={getWaterRetainCellStyle?.(retained)}
          title={p.uuid ? 'View plant' : undefined}
        >
          {p.uuid ? (
            <a
              href={`/plants/${p.uuid}`}
              onClick={(e) => {
                e.preventDefault()
                onViewPlant?.(p)
              }}
              className="block-link"
            >
              {p.identify_hint ? `${p.identify_hint} ` : ''}
              {p.name}
            </a>
          ) : (
            (p.identify_hint ? `${p.identify_hint} ` : '') + (p.name || '')
          )}
        </td>
        <td className="td" title={p.uuid ? 'View plant' : undefined}>
          {p.uuid ? (
            <a
              href={`/plants/${p.uuid}`}
              onClick={(e) => {
                e.preventDefault()
                onViewPlant?.(p)
              }}
              className="block-link"
            >
              {p.notes || '—'}
            </a>
          ) : (
            p.notes || '—'
          )}
        </td>
        <td className="td hide-column-phone" style={{ minWidth: 90 }}>
          {p.location || '—'}
        </td>
        <td
          className="td hide-column-phone"
          style={computeWaterLossStyle?.(displayWaterLoss)}
          title={p.uuid ? 'View plant' : undefined}
        >
          {p.uuid ? (
            <a
              href={`/plants/${p.uuid}`}
              onClick={(e) => {
                e.preventDefault()
                onViewPlant?.(p)
              }}
              className="block-link"
            >
              {displayWaterLossText}
            </a>
          ) : (
            displayWaterLossText
        )}
      </td>
      {showUpdatedColumn && (
          <td className="td hide-column-tablet" style={{ minWidth: 100 }}>
            {operationMode === 'vacation' ? (
              '—'
            ) : (
              <DateTimeText
                value={p.latest_at || p.measured_at}
                title={p.latest_at || p.measured_at}
              />
            )}
          </td>
        )}
      </>
    )
  }

  const rowProps = (p) => {
    const deemphasize = typeof deemphasizePredicate === 'function' ? deemphasizePredicate(p) : false
    return deemphasize ? { style: { opacity: 0.55 } } : {}
  }

  return (
    <PlantsTableBase
      plants={plants}
      renderHeaders={renderHeaders}
      renderRow={renderRow}
      rowProps={rowProps}
      emptyMessage={noPlantsMessage}
      className="table plants-table"
    />
  )
}
