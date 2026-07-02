/**
 * Checks if a plant needs watering. Delegates to the backend-computed
 * `needs_water` field, which is the single source of truth.
 *
 * @param {Object} plant - The plant object.
 * @returns {boolean} - True if the plant needs watering.
 */
export function checkNeedsWater(plant) {
  return !!plant?.needs_water
}

/**
 * Gets the water retained percentage to display based on mode and data.
 *
 * @param {Object} plant - The plant object.
 * @param {string} mode - Current operation mode.
 * @param {Object} [approximation] - Approximation data.
 * @returns {string|number} - The percentage to display or "N/A".
 */
export function getWaterRetainedPct(plant, mode, approximation = null) {
  if (mode === 'vacation' && approximation) {
    const val = approximation.virtual_water_retained_pct
    return val !== undefined && val !== null ? Math.round(val) : 'N/A'
  }
  const val = plant?.water_retained_pct
  return val !== undefined && val !== null ? Math.round(val) : 'N/A'
}
