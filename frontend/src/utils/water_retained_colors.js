
/**
 * Returns CSS styles based on water retention percentage for plant care indicators
 * @param {number} waterRemainingPct - Percentage of water retained (0-100)
 * @returns {Object} CSS styles object
 */
export function getWaterRetainCellStyle(waterRemainingPct) {
  if (waterRemainingPct < 0) {
    return {
      background: '#dc2626',
      color: 'white',
    }
  } else if (waterRemainingPct < 20) {
    return {
      background: '#2c4fff',
      color: 'white',
    }
  } else if (waterRemainingPct < 40) {
    return {
      background: '#77bcff',
    }
  } else if (waterRemainingPct < 50) {
    return {
      background: 'rgba(137,204,255,0.44)',
    }
  } else if (waterRemainingPct < 60) {
    return {
      background: '#bbf7d0',
    }
  } else if (waterRemainingPct < 100) {
    return {
      color: 'black',
    }
  } else {
    return {
      color: 'green',
    }
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
