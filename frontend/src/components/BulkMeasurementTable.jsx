import React from 'react'
import {
  getWaterRetainCellStyle,
  getWaterLossCellStyle as defaultWaterLossCellStyle,
} from '../utils/water_retained_colors.js'
import Badge from './Badge.jsx'
import DateTimeText from './DateTimeText.jsx'
import { checkNeedsWater, getWaterRetainedPct } from '../utils/watering'
import WaterDropIcon from './icons/WaterDropIcon.jsx'
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
  approximations = {},
  noPlantsMessage = 'No plants found',
}) {
  const computeWaterLossStyle = waterLossCellStyle || defaultWaterLossCellStyle

  const renderHeaders = () => (
    <>
      <TableHeader title={firstColumnTooltip}>{firstColumnLabel}</TableHeader>
      <TableHeader title="Watering threshold — water when retained ≤ value">Thresh</TableHeader>
      <TableHeader title="Plant name">Name</TableHeader>
      <TableHeader title="Notes">Notes</TableHeader>
      <TableHeader title="Location" className="th hide-column-phone">
        Location
      </TableHeader>
      <TableHeader
        title={
          operationMode === 'vacation'
            ? 'Projected water loss based on frequency (100 - retained %)'
            : 'Water loss since last watering based on weight'
        }
      >
        Water loss
      </TableHeader>
      {showUpdatedColumn && (
        <TableHeader title="Last update time" className="th hide-column-tablet">
          Updated
        </TableHeader>
      )}
    </>
  )

  const renderRow = (p) => {
    const approx = approximations[p.uuid]
    const needsWater = checkNeedsWater(p, operationMode, approx)
    const needsMeasure = p.needs_weighing

    const retained = getWaterRetainedPct(p, operationMode, approx)
    const displayRetained = typeof retained === 'number' ? `${retained}%` : retained

    const displayWaterLoss =
      operationMode === 'vacation' && typeof retained === 'number'
        ? 100 - retained
        : p.water_loss_total_pct !== undefined && p.water_loss_total_pct !== null
          ? Math.round(p.water_loss_total_pct)
          : p.water_loss_total_pct

    const status = inputStatus[p.uuid]
    const mId = measurementIds[p.uuid]
    const isSaving = status === 'saving'

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
                  type="number"
                  style={{ width: 60 }}
                  className={`input ${status === 'success' ? 'bg-success' : ''} ${
                    status === 'error' ? 'bg-error' : ''
                  }`}
                  defaultValue={p.current_weight || ''}
                  onBlur={(e) => {
                    if (e.target.value && p.uuid) onCommitValue(p.uuid, e.target.value)
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
                      fontSize: 16,
                      color: '#ef4444',
                      fontWeight: 'bold',
                      borderRadius: 4,
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
            {retained !== 'N/A' && (
              <span style={{ fontSize: '0.9em', color: '#6b7280' }}>{displayRetained}</span>
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
            )}
            {needsMeasure && (
              <Badge tone="info" title="Needs weighing (>18h since last update)">
                Needs weight
              </Badge>
            )}
          </div>
        </td>
        <td className="td">{p.recommended_water_threshold_pct}%</td>
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
        <td className="td hide-column-phone">{p.location || '—'}</td>
        <td
          className="td"
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
              {displayWaterLoss}%
            </a>
          ) : (
            displayWaterLoss
          )}
        </td>
        {showUpdatedColumn && (
          <td className="td hide-column-tablet">
            {operationMode === 'vacation' ? (
              '—'
            ) : (
              <DateTimeText value={p.latest_at || p.measured_at} />
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
