import React from 'react'
import { valueStyle, getWaterRetainCellStyle, getWaterLossCellStyle as defaultWaterLossCellStyle } from '../utils/water_retained_colors.js'
import Badge from './Badge.jsx'
import DateTimeText from './DateTimeText.jsx'

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
            const retained = Number(p?.water_retained_pct)
            const thresh = Number(p?.recommended_water_threshold_pct)
            const needsWater = !Number.isNaN(retained) && !Number.isNaN(thresh) && retained <= thresh
            const deemphasize = typeof deemphasizePredicate === 'function' ? deemphasizePredicate(p) : false
            return (
            <tr key={rowKey} style={deemphasize ? { opacity: 0.55 } : undefined}>
                <td className="td" style={{ width: 200, whiteSpace: 'nowrap' }}>
                  <input
                    type="number"
                    style={{ width: 50, verticalAlign: 'middle', display: 'inline-block' }}
                    className={`input ${inputStatus[p.uuid] === 'success' ? 'bg-success' : ''} ${inputStatus[p.uuid] === 'error' ? 'bg-error' : ''}`}
                    defaultValue={p.current_weight || ''}
                    onBlur={(e) => {
                      if (e.target.value && p.uuid) onCommitValue(p.uuid, e.target.value)
                    }}
                    onChange={(e) => {
                      e.target.value = e.target.value
                    }}
                  />
                  <span style={{ paddingLeft: 10, verticalAlign: 'middle', display: 'inline-block' }}>
                    {p.water_retained_pct}%
                    {needsWater && (
                      <Badge tone="warning" title="Needs water based on threshold" style={{ marginLeft: 8 }}>
                        Needs water
                      </Badge>
                    )}
                  </span>
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
