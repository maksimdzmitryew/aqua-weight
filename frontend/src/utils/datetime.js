export function formatDateTime(v) {
  try {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return String(v)

    // Read preference; default to 'europe'
    const pref = (typeof localStorage !== 'undefined' && localStorage.getItem('dtFormat')) || 'europe'

    const isEurope = pref === 'europe'
    const locale = isEurope ? 'en-GB' : 'en-US'
    const opts = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: !isEurope,
    }

    return d.toLocaleString(locale, opts)
  } catch {
    return String(v)
  }
}

// Returns current local datetime formatted for <input type="datetime-local">, to minutes precision.
export function nowLocalISOMinutes() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  return `${y}-${m}-${day}T${hh}:${mm}`
}
