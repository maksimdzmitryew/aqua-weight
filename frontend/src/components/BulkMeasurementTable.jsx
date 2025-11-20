import React from 'react'
import { getWaterRetainCellStyle, getWaterLossCellStyle } from '../utils/water_retained_colors.js'

export default function BulkMeasurementTable({
  plants,
  inputStatus,
  onCommitValue,
  onViewPlant,
  firstColumnLabel = 'New value',
  getWaterLossCellStyle,
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table plants-table">
        <thead>
          <tr>
            <th className="th">Water retained</th>
            <th className="th">{firstColumnLabel}</th>
            <th className="th">Water loss</th>
            <th className="th">Name</th>
            <th className="th">Description</th>
            <th className="th hide-column-phone">Location</th>
          </tr>
        </thead>
        <tbody>
          {plants.map((p) => (
            <tr key={p.uuid || p.id}>
              <td className="td" style={getWaterRetainCellStyle?.(p.water_retained_pct)} title={p.uuid ? 'View plant' : undefined}>
                {p.uuid ? (
                  <a
                    href={`/plants/${p.uuid}`}
                    onClick={(e) => { e.preventDefault(); onViewPlant?.(p) }}
                    className="block-link"
                  >
                    {p.water_retained_pct}%
                  </a>
                ) : (
                  p.water_retained_pct
                )}
              </td>
              <td className="td">
                <input
                  type="number"
                  className={`input ${inputStatus[p.uuid] === 'success' ? 'bg-success' : ''} ${inputStatus[p.uuid] === 'error' ? 'bg-error' : ''}`}
                  defaultValue={p.current_weight || ''}
                  onBlur={(e) => {
                    if (e.target.value && p.uuid) {
                      onCommitValue(p.uuid, e.target.value)
                    }
                  }}
                  onChange={(e) => {
                    const input = e.target
                    input.value = e.target.value
                  }}
                />
              </td>
              <td className="td" style={getWaterLossCellStyle?.(p.water_loss_total_pct)} title={p.uuid ? 'View plant' : undefined}>
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
              <td className="td" title={p.uuid ? 'View plant' : undefined}>
                {p.uuid ? (
                  <a
                    href={`/plants/${p.uuid}`}
                    onClick={(e) => { e.preventDefault(); onViewPlant?.(p) }}
                    className="block-link"
                  >
                    {p.name}
                  </a>
                ) : (
                  p.name
                )}
              </td>
              <td className="td" title={p.uuid ? 'View plant' : undefined}>
                {p.uuid ? (
                  <a
                    href={`/plants/${p.uuid}`}
                    onClick={(e) => { e.preventDefault(); onViewPlant?.(p) }}
                    className="block-link"
                  >
                    {p.description || '—'}
                  </a>
                ) : (
                  p.description || '—'
                )}
              </td>
              <td className="td hide-column-phone">{p.location || '—'}</td>
            </tr>
          ))}
          {plants.length === 0 && (
            <tr>
              <td className="td" colSpan={5}>No plants found</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
