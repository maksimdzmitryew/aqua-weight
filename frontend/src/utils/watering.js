/**
 * Checks if a plant needs watering based on the operation mode and available data.
 *
 * @param {Object} plant - The plant object.
 * @param {string} mode - The current operation mode ('manual', 'automatic', 'vacation').
 * @param {Object} [approximation] - The approximation data for the plant (required for vacation mode).
 * @returns {boolean} - True if the plant needs watering.
 */
export function checkNeedsWater(plant, mode, approximation = null, defaultThreshold = 40) {
  if (mode === 'vacation') {
    return (
      !!approximation &&
      ((approximation.days_offset !== undefined &&
        approximation.days_offset !== null &&
        Number(approximation.days_offset) <= 0) ||
        (approximation.virtual_water_retained_pct !== undefined &&
          approximation.virtual_water_retained_pct !== null &&
          Number(approximation.virtual_water_retained_pct) <=
            Number(plant?.recommended_water_threshold_pct || defaultThreshold)))
    )
  }
  if (plant?.needs_watering_prediction) {
    return true
  }

  // If the plant was just watered (signature: water_loss_total_pct is 0),
  // it doesn't need water in manual/automatic mode, UNLESS it's already dry
  // (which can happen if the last watering was a retrospective vacation event).
  if (
    plant?.water_loss_total_pct === 0 &&
    (plant?.water_retained_pct === null || Number(plant?.water_retained_pct) > 0)
  ) {
    return false
  }

  // manual or automatic (default)
  const retained = plant?.water_retained_pct
  if (retained !== null && retained !== undefined) {
    let thresh = plant?.recommended_water_threshold_pct
    if (thresh === null || thresh === undefined) {
      thresh = defaultThreshold
    }

    const rNum = Number(retained)
    const tNum = Number(thresh)
    return !Number.isNaN(rNum) && !Number.isNaN(tNum) && rNum <= tNum
  }

  // If we have no weight data, and no approximation, we assume it needs attention
  // (weighing/watering) by default to avoid missing plants.
  if (
    approximation &&
    approximation.days_offset !== undefined &&
    approximation.days_offset !== null
  ) {
    return Number(approximation.days_offset) <= 0
  }
  return true
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
