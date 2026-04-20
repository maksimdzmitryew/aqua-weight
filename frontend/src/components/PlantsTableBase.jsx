import React from 'react'

/**
 * PlantsTableBase - Base component for plant tables
 *
 * Provides common structure for plant tables while allowing full customization
 * of columns and cell rendering through render props pattern.
 *
 * @param {Object} props
 * @param {Array} props.plants - Array of plant objects to display
 * @param {Function} props.renderHeaders - Function that returns table header <th> elements
 * @param {Function} props.renderRow - Function that receives (plant, index) and returns <tr> content
 * @param {string} props.emptyMessage - Message to show when no plants (optional)
 * @param {string} props.className - Additional CSS class for table (optional)
 * @param {Object} props.rowProps - Function that receives (plant, index) and returns props for <tr> (optional)
 *
 * @example
 * <PlantsTableBase
 *   plants={plants}
 *   renderHeaders={() => (
 *     <>
 *       <th>Name</th>
 *       <th>Location</th>
 *     </>
 *   )}
 *   renderRow={(plant) => (
 *     <>
 *       <td>{plant.name}</td>
 *       <td>{plant.location}</td>
 *     </>
 *   )}
 * />
 */
export default function PlantsTableBase({
  plants,
  renderHeaders,
  renderRow,
  emptyMessage = 'No plants found',
  className = 'table plants-table',
  rowProps,
}) {
  if (!plants || plants.length === 0) {
    return (
      <div className="overflow-x-auto">
        <table className={className}>
          <thead>
            <tr>{renderHeaders()}</tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan="100" style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                {emptyMessage}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className={className}>
        <thead>
          <tr>{renderHeaders()}</tr>
        </thead>
        <tbody>
          {plants.map((plant, idx) => {
            const key = plant.uuid || plant.id || `row-${idx}`
            const additionalProps = typeof rowProps === 'function' ? rowProps(plant, idx) : {}

            return (
              <tr key={key} {...additionalProps}>
                {renderRow(plant, idx)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * TableHeader - Helper component for consistent table headers with tooltips
 *
 * @param {Object} props
 * @param {string} props.title - Tooltip text
 * @param {string} props.children - Header label text
 * @param {string} props.className - Additional CSS classes (optional)
 * @param {string} props.scope - Scope attribute (default: "col")
 */
export function TableHeader({ title, children, className = 'th', scope = 'col' }) {
  return (
    <th className={className} scope={scope} title={title}>
      <span style={{ pointerEvents: 'none' }}>{children}</span>
      {title && (
        <span
          aria-hidden="true"
          style={{ marginLeft: 6, color: '#6b7280', cursor: 'help', pointerEvents: 'none' }}
        >
          ⓘ
        </span>
      )}
    </th>
  )
}
