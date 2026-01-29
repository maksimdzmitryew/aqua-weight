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

  // If the plant was just watered (signature: water_loss_total_pct is 0),
  // it doesn't need water in manual/automatic mode, UNLESS it's already dry
  // (which can happen if the last watering was a retrospective vacation event).
  if (plant?.water_loss_total_pct === 0 && Number(plant?.water_retained_pct) > 0) {
    return false
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
  if (mode === 'vacation' && approximation) {
    const val = approximation.virtual_water_retained_pct
    return (val !== undefined && val !== null) ? Math.round(val) : 'N/A'
  }
  const val = plant?.water_retained_pct
  return (val !== undefined && val !== null) ? Math.round(val) : 'N/A'
}
