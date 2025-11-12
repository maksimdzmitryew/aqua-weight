// Shared helper for styling water loss percentage cells
// Keeps thresholds consistent across bulk measurement pages
export function waterLossCellStyle(waterLossPct) {
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
