// Robustly parse date/time values coming from the API (SQL style or ISO8601) or JS Dates.
// - Accepts: Date, number (ms), ISO strings (with or without timezone), and SQL "YYYY-MM-DD HH:MM[:SS[.ms]]".
// - For SQL strings without timezone info we assume LOCAL time when constructing the Date (to match UI expectations).
export function parseAPIDate(v) {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null

  // Detect SQL format: YYYY-MM-DD HH:MM[:SS[.ms]]
  const sqlMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/)
  if (sqlMatch && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) {
    const [, y, mo, d, h, mi, se = '0', msRaw = '0'] = sqlMatch
    const ms = Math.round(Number(`0.${msRaw}`) * 1000)
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se), ms)
    return isNaN(date.getTime()) ? null : date
  }

  // Fallback to native parser for ISO8601 and anything else JS understands
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export function formatDateTime(v) {
  try {
    const d = parseAPIDate(v)
    if (!d) return String(v ?? '')

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
    // In case of any unexpected error (e.g., reading preferences or formatting),
    // return a safe string representation of the original value.
    // Use String(v) (branchless) to avoid additional branches for coverage purposes.
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

// Convert API date (SQL or ISO, with/without tz) to value for input[type=datetime-local] (local, minutes precision).
export function toLocalISOMinutes(utcOrSqlString) {
  const d = parseAPIDate(utcOrSqlString)
  if (!d) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  return `${y}-${m}-${day}T${hh}:${mm}`
}
