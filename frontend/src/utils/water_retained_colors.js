export const valueStyle = {
  position: 'relative', // above the bar
  zIndex: 2,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums'
};

/**
 * Returns CSS styles based on water retention percentage for plant care indicators
 * @param {number} waterRemainingPct - Percentage of water retained (0-100)
 * @returns {Object} CSS styles object
 */
export function getWaterRetainCellStyle(waterRemainingPct) {
  let widthPct = Math.max(0, Math.min(100, waterRemainingPct));

  return {
    background: `linear-gradient(90deg, rgba(79, 173, 255, 0.28) ${widthPct}%, transparent ${widthPct}%)`,
  }
}

export function getWaterLossCellStyle(waterLossPct) {
    if (waterLossPct > 100) {
      return { background: '#dc2626', color: 'white' }
    } else if (waterLossPct > 80) {
      return { background: '#fecaca' }
    } else if (waterLossPct > 40) {
      return { background: '#fef3c7' }
    } else if (waterLossPct > 3) {
      return { background: '#bbf7d0' }
    } else if (waterLossPct > -1) {
      return { color: 'green' }
    } else {
      return { color: 'red' }
    }
  }
