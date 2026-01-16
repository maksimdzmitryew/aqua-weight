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
