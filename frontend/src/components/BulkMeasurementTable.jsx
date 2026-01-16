import React from 'react'
import { valueStyle, getWaterRetainCellStyle, getWaterLossCellStyle as defaultWaterLossCellStyle } from '../utils/water_retained_colors.js'
import Badge from './Badge.jsx'
import DateTimeText from './DateTimeText.jsx'
import { checkNeedsWater } from '../utils/watering'

export default function BulkMeasurementTable({
  plants,
  inputStatus,
  onCommitValue,
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
}) {
  const computeWaterLossStyle = waterLossCellStyle || defaultWaterLossCellStyle
  return (
    <div className="overflow-x-auto">
      <table className="table plants-table">
        <thead>
          <tr>
            <th className="th" scope="col" title={firstColumnTooltip}>
              <span>{firstColumnLabel}</span>
              {firstColumnTooltip && (
                <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
              )}
            </th>
            <th className="th" scope="col" title="Watering threshold — water when retained ≤ value">
              <span>Thresh</span>
              <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
            </th>
            <th className="th" scope="col" title="Plant name">
              <span>Name</span>
              <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
            </th>
            <th className="th" scope="col" title="Notes">
              <span>Notes</span>
              <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
            </th>
            <th className="th hide-column-phone" scope="col" title="Location">
              <span>Location</span>
              <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
            </th>
            <th className="th" scope="col" title="Water loss since last watering">
              <span>Water loss</span>
              <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
            </th>
            {showUpdatedColumn && (
              <th className="th hide-column-tablet" scope="col" title="Last update time">
                <span>Updated</span>
                <span aria-hidden="true" style={{ marginLeft: 6, color: '#6b7280' }}>ⓘ</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {plants.map((p, idx) => {
            const rowKey = p.uuid || p.id || `row-${idx}`
            const approx = approximations[p.uuid]
            const needsWater = checkNeedsWater(p, operationMode, approx)
            const deemphasize = typeof deemphasizePredicate === 'function' ? deemphasizePredicate(p) : false
            
            return (
            <tr key={rowKey} style={deemphasize ? { opacity: 0.55 } : undefined}>
                <td className="td" style={{ width: 200, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="number"
                      style={{ width: 60 }}
                      className={`input ${inputStatus[p.uuid] === 'success' ? 'bg-success' : ''} ${inputStatus[p.uuid] === 'error' ? 'bg-error' : ''}`}
                      defaultValue={p.current_weight || ''}
                      onBlur={(e) => {
                        if (e.target.value && p.uuid) onCommitValue(p.uuid, e.target.value)
                      }}
                      onChange={(e) => {
                        e.target.value = e.target.value
                      }}
                    />
                    {typeof p.water_retained_pct === 'number' && (
                      <span style={{ fontSize: '0.9em', color: '#6b7280' }}>
                        {p.water_retained_pct}%
                      </span>
                    )}
                    {needsWater && (
                      <Badge tone="warning" title={operationMode === 'vacation' ? "Needs water based on approximation" : "Needs water based on threshold"}>
                        Needs water
                      </Badge>
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
                          ...(approx.days_offset < 0 ? { background: '#fecaca', color: '#b91c1c' } : { color: '#6b7280' })
                        }}
                      >
                        <DateTimeText value={approx.first_calculated_at || approx.next_watering_at} mode="daymonth" showTooltip={false} />
                        {approx.days_offset !== undefined && approx.days_offset !== null && (
                          <span style={{ opacity: 0.8 }}>
                            ({approx.days_offset}d)
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </td>
                <td className="td">
                  {p.recommended_water_threshold_pct}%
                </td>
                <td className="td" style={getWaterRetainCellStyle?.(p.water_retained_pct)} title={p.uuid ? 'View plant' : undefined}>
                {p.uuid ? (
                  <a
                    href={`/plants/${p.uuid}`}
                    onClick={(e) => { e.preventDefault(); onViewPlant?.(p) }}
                    className="block-link"
                  >
                    {(p.identify_hint ? `${p.identify_hint} ` : '')}{p.name}
                  </a>
                ) : (
                  (p.identify_hint ? `${p.identify_hint} ` : '') + (p.name || '')
                )}
              </td>
              <td className="td" title={p.uuid ? 'View plant' : undefined}>
                {p.uuid ? (
                  <a
                    href={`/plants/${p.uuid}`}
                    onClick={(e) => { e.preventDefault(); onViewPlant?.(p) }}
                    className="block-link"
                  >
                    {p.notes || '—'}
                  </a>
                ) : (
                  p.notes || '—'
                )}
              </td>
              <td className="td hide-column-phone">{p.location || '—'}</td>
              <td className="td" style={computeWaterLossStyle?.(p.water_loss_total_pct)} title={p.uuid ? 'View plant' : undefined}>
                {p.uuid ? (
                  <a
                    href={`/plants/${p.uuid}`}
                    onClick={(e) => { e.preventDefault(); onViewPlant?.(p) }}
                    className="block-link"
                  >
                    {p.water_loss_total_pct}%
                  </a>
                ) : (
                  p.water_loss_total_pct
                )}
              </td>
              {showUpdatedColumn && (
                <td className="td hide-column-tablet">
                  <DateTimeText value={p.latest_at || p.measured_at} />
                </td>
              )}
            </tr>
          )})}
          {plants.length === 0 && (
            <tr>
              <td className="td" colSpan={showUpdatedColumn ? 7 : 6}>No plants found</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
