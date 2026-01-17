/**
 * Checks if a plant needs watering based on the operation mode and available data.
 * 
 * @param {Object} plant - The plant object.
 * @param {string} mode - The current operation mode ('manual', 'automatic', 'vacation').
 * @param {Object} [approximation] - The approximation data for the plant (required for vacation mode).
 * @returns {boolean} - True if the plant needs watering.
 */
export function checkNeedsWater(plant, mode, approximation = null) {
  if (mode === 'vacation') {
    return !!approximation && approximation.days_offset != null && approximation.days_offset <= 0
  }

  // manual or automatic (default)
  const retained = Number(plant?.water_retained_pct)
  const thresh = Number(plant?.recommended_water_threshold_pct)
  return !Number.isNaN(retained) && !Number.isNaN(thresh) && retained <= thresh
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
  if (mode === 'vacation') {
    return 0
  }

  // If in non-vacation mode, we ALWAYS use the plant's DB value.
  const val = plant?.water_retained_pct
  return (val !== undefined && val !== null) ? Math.round(val) : 'N/A'
}
