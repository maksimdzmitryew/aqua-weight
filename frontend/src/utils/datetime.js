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
