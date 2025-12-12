import React from 'react'
import { useTheme } from '../ThemeContext.jsx'

/**
 * Minimal sparkline/line chart component using pure SVG.
 * Props:
 * - data: array of { x: number (timestamp ms), y: number }
 * - width, height: numbers (px)
 * - stroke: color
 * - strokeWidth: number
 * - fill: optional area fill color (falsy = no fill)
 * - margin: { top, right, bottom, left }
 */
export default function Sparkline({
  data = [],
  width = 240,
  height = 80,
  stroke,
  strokeWidth = 2,
  fill,
  // Default margins: provide extra bottom space for below-axis date labels (two lines)
  margin = { top: 6, right: 2, bottom: 26, left: 12 },
  dotLast = true,
  showPoints = false,
  // Optional horizontal reference lines (e.g., Dry/Max/Threshold)
  // Each item: { y: number, color?: string, label?: string, dash?: string }
  refLines = [],
  hover = true, // enable interactive hover tooltip
  hoverFormatter, // optional (pt, i, ctx) => string[] lines
  tooltipPlacement = 'side', // 'below' | 'side'
  tooltipOffsetX = 28, // extra pixels to shift tooltip horizontally from the hover point when placed on the side (doubled per request)
  // Watering hints: draw vertical lines at peaks if delta from previous point
  // exceeds a fraction of the maximum water retained. The fraction defaults to 20%.
  // maxWaterG: number | null — maximum water retained (grams)
  maxWaterG = null,
  // peakDeltaPct: number — threshold fraction (e.g., 0.1 for 10%)
  peakDeltaPct = 0.20,
  // showPeakVLines: toggle rendering of vertical lines
  showPeakVLines = true,
  // show labels (date) near each vertical line
  showPeakVLineLabels = true,
  // New: show a vertical marker at the first data point where the value drops
  // below the recommended threshold (detected from a ref line labeled "Thresh").
  showFirstBelowThreshVLine = true,
}) {
  const { effectiveTheme } = useTheme()
  const defaultStroke = stroke || (effectiveTheme === 'dark' ? '#60a5fa' : '#2563eb')
  const defaultFill = fill === undefined ? (effectiveTheme === 'dark' ? 'rgba(96,165,250,0.15)' : 'rgba(37,99,235,0.12)') : fill
  // Responsive width: measure the actual container width so geometry matches pixels
  const containerRef = React.useRef(null)
  const svgRef = React.useRef(null)
  const [measuredW, setMeasuredW] = React.useState(null)

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Initial measurement
    const update = () => {
      const w = el.clientWidth
      if (w && w !== measuredW) setMeasuredW(w)
    }
    update()
    // Observe size changes
    let ro
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(() => update())
      ro.observe(el)
    } else {
      // Fallback: listen to window resize
      window.addEventListener('resize', update)
    }
    return () => {
      if (ro) ro.disconnect()
      else window.removeEventListener('resize', update)
    }
  }, [])

  const vbWidth = typeof width === 'number' ? width : (measuredW || 300)
  const vbHeight = height
  const w = Math.max(0, vbWidth - margin.left - margin.right)
  const h = Math.max(0, vbHeight - margin.top - margin.bottom)

  const points = Array.isArray(data) ? data.filter(d => d && isFinite(d.x) && isFinite(d.y)) : []
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  // Include reference line values in Y-domain so they are always visible
  const refYs = (Array.isArray(refLines) ? refLines : []).map(rl => rl && isFinite(rl.y) ? rl.y : null).filter(v => v != null)
  const minX = xs.length ? Math.min(...xs) : 0
  const maxX = xs.length ? Math.max(...xs) : 1
  const minYData = ys.length ? Math.min(...ys) : Infinity
  const maxYData = ys.length ? Math.max(...ys) : -Infinity
  const minYRef = refYs.length ? Math.min(...refYs) : Infinity
  const maxYRef = refYs.length ? Math.max(...refYs) : -Infinity
  let minY = Math.min(minYData, minYRef)
  let maxY = Math.max(maxYData, maxYRef)
  if (!isFinite(minY)) minY = 0
  if (!isFinite(maxY) || maxY === minY) maxY = (isFinite(minY) ? minY + 1 : 1)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1

  function sx(x) { return margin.left + ((x - minX) / spanX) * w }
  function sy(y) { return margin.top + (1 - (y - minY) / spanY) * h }

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x)},${sy(p.y)}`).join(' ')

  // Area path (optional)
  const area = points.length > 1 && defaultFill ? `${path} L${sx(points[points.length - 1].x)},${margin.top + h} L${sx(points[0].x)},${margin.top + h} Z` : ''

  const last = points[points.length - 1]

  // Resolve threshold Y from refLines (label "Thresh", case-insensitive)
  let threshYValue = null
  if (Array.isArray(refLines)) {
    for (const rl of refLines) {
      if (rl && isFinite(rl.y)) {
        const lbl = (rl.label == null ? '' : String(rl.label)).toLowerCase()
        if (lbl === 'thresh') { threshYValue = rl.y; break }
      }
    }
  }

  // Compute first-below-threshold marker: find first index i where
  // points[i-1].y >= thresh and points[i].y < thresh.
  let firstBelowThresh = null
  if (showFirstBelowThreshVLine && threshYValue != null && isFinite(threshYValue) && points.length > 1) {
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const cur = points[i]
      if (!prev || !cur) continue
      if (isFinite(prev.y) && isFinite(cur.y) && prev.y >= threshYValue && cur.y < threshYValue) {
        firstBelowThresh = { x: cur.x, y: cur.y, index: i }
        break
      }
    }
  }

  // Helpers to operate on calendar days (local time), ignoring precise time-of-day
  const dayKey = (ts) => {
    const d = new Date(ts)
    if (!isFinite(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const startOfDay = (ts) => {
    const d = new Date(ts)
    if (!isFinite(d.getTime())) return NaN
    // Local midnight
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }

  // Compute watering hint vertical lines (peaks with large positive jump vs previous)
  // Each item is { x: number, y: number, prevY: number, label: string, daysSince: number }
  let peakVLines = []
  const threshAbs = (isFinite(maxWaterG) && maxWaterG > 0 && isFinite(peakDeltaPct) && peakDeltaPct > 0)
    ? (maxWaterG * peakDeltaPct)
    : null
  if (showPeakVLines && threshAbs != null && points.length > 2) {
    // Read user preference for date format from localStorage (persisted by Settings page)
    let dtPref = 'europe'
    try {
      const stored = localStorage.getItem('dtFormat')
      if (stored === 'usa' || stored === 'europe') dtPref = stored
    } catch {}
    const pad2 = (n) => String(n).padStart(2, '0')
    let lastPeakTs = null
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1]
      const cur = points[i]
      const next = points[i + 1]
      if (!prev || !cur || !next) continue
      const isPeak = (cur.y > prev.y) && (cur.y > next.y)
      const deltaPrev = cur.y - prev.y
      if (isPeak && deltaPrev >= threshAbs) {
        const d = new Date(cur.x)
        const mm = pad2(d.getMonth() + 1)
        const dd = pad2(d.getDate())
        const label = dtPref === 'usa' ? `${mm}/${dd}` : `${dd}/${mm}`
        let daysSince = 0
        if (lastPeakTs != null && isFinite(lastPeakTs)) {
          // Compute difference in whole calendar days, ignoring time-of-day
          const a = startOfDay(lastPeakTs)
          const b = startOfDay(cur.x)
          const msPerDay = 24 * 60 * 60 * 1000
          daysSince = Math.max(0, Math.floor((b - a) / msPerDay))
        }
        peakVLines.push({ x: cur.x, y: cur.y, prevY: prev.y, label, daysSince })
        lastPeakTs = cur.x
      }
    }
  }

  // Hover state and helpers
  const [hoverIdx, setHoverIdx] = React.useState(null)
  const hasHover = hover && points.length > 0

  function findNearestIndexByX(domainX) {
    if (!points.length) return null
    // Linear scan is sufficient for small series
    let best = 0
    let bestDist = Math.abs(points[0].x - domainX)
    for (let i = 1; i < points.length; i++) {
      const d = Math.abs(points[i].x - domainX)
      if (d < bestDist) { best = i; bestDist = d }
    }
    return best
  }

  function onMouseMove(e) {
    if (!hasHover || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (!isFinite(px)) return
    const scaleX = vbWidth / Math.max(1, rect.width)
    const vbX = px * scaleX
    const plotX = Math.min(margin.left + w, Math.max(margin.left, vbX))
    const t = minX + ((plotX - margin.left) / Math.max(1, w)) * spanX
    const idx = findNearestIndexByX(t)
    setHoverIdx(idx)
  }

  function onMouseLeave() {
    if (!hasHover) return
    setHoverIdx(null)
  }

  // Build tooltip content
  function defaultHoverLines(idx) {
    const pt = points[idx]
    if (!pt) return []
    const date = new Date(pt.x)
    // Format date/time according to Settings preference
    let dtPref = 'europe'
    try {
      const stored = localStorage.getItem('dtFormat')
      if (stored === 'usa' || stored === 'europe') dtPref = stored
    } catch {}
    const pad2 = (n) => String(n).padStart(2, '0')
    let dateStr
    if (!isFinite(date.getTime())) {
      dateStr = String(pt.x)
    } else if (dtPref === 'usa') {
      // MM/DD/YYYY h:mm AM/PM (12h clock)
      const mm = pad2(date.getMonth() + 1)
      const dd = pad2(date.getDate())
      const yyyy = date.getFullYear()
      let hh = date.getHours()
      const ampm = hh >= 12 ? 'PM' : 'AM'
      hh = hh % 12
      if (hh === 0) hh = 12
      const mins = pad2(date.getMinutes())
      dateStr = `${mm}/${dd}/${yyyy} ${hh}:${mins} ${ampm}`
    } else {
      // DD/MM/YYYY HH:mm (24h clock)
      const mm = pad2(date.getMonth() + 1)
      const dd = pad2(date.getDate())
      const yyyy = date.getFullYear()
      const hh = pad2(date.getHours())
      const mins = pad2(date.getMinutes())
      dateStr = `${dd}/${mm}/${yyyy} ${hh}:${mins}`
    }
    const lines = [dateStr, `${pt.y} g`]
    if (idx > 0) {
      const prev = points[idx - 1]
      if (prev) {
        const delta = pt.y - prev.y
        const sign = delta > 0 ? '+' : ''
        lines.push(`Δ ${sign}${Math.round(delta)} g`)
      }
    }
    return lines
  }

  const tooltipLines = (hoverIdx != null)
    ? (typeof hoverFormatter === 'function' ? hoverFormatter(points[hoverIdx], hoverIdx, { points }) : defaultHoverLines(hoverIdx))
    : []
  const tooltipLineHeight = 12
  const tooltipFontSize = 11
  const tooltipPadX = 6
  const tooltipPadY = 5
  const approxCharW = 6.2
  const maxTooltipW = 180 // px, tighter cap to avoid "stretched" look
  const minTooltipW = 60 // px, avoid overly tiny boxes

  // Wrap a single line into multiple lines so the tooltip isn't overly wide
  function wrapLine(line, contentMaxW) {
    const words = String(line || '').split(/\s+/)
    const result = []
    let cur = ''
    const fits = (text) => (text.length * approxCharW) <= contentMaxW
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (!cur) {
        if (fits(w)) cur = w
        else {
          // Hard-break very long tokens
          let token = w
          while (token.length && !fits(token)) {
            const take = Math.max(1, Math.floor(contentMaxW / approxCharW))
            result.push(token.slice(0, take))
            token = token.slice(take)
          }
          if (token) cur = token
        }
      } else {
        const candidate = cur + ' ' + w
        if (fits(candidate)) cur = candidate
        else {
          result.push(cur)
          if (fits(w)) cur = w
          else {
            // Hard-break long token
            let token = w
            while (token.length && !fits(token)) {
              const take = Math.max(1, Math.floor(contentMaxW / approxCharW))
              result.push(token.slice(0, take))
              token = token.slice(take)
            }
            cur = token
          }
        }
      }
    }
    if (cur) result.push(cur)
    return result
  }

  // Wrap all lines and compute geometry
  let wrappedLines = []
  if (tooltipLines.length) {
    const contentMaxW = Math.max(40, maxTooltipW - tooltipPadX * 2)
    for (const ln of tooltipLines) {
      const segments = wrapLine(ln, contentMaxW)
      wrappedLines.push(...segments)
    }
  }
  const measureWidth = (s) => (s.length * approxCharW)
  const contentWidth = wrappedLines.length ? Math.min(maxTooltipW - tooltipPadX * 2, Math.max(...wrappedLines.map(measureWidth))) : 0
  const tooltipWidth = wrappedLines.length ? Math.max(minTooltipW, contentWidth + tooltipPadX * 2) : 0
  const tooltipHeight = wrappedLines.length ? wrappedLines.length * tooltipLineHeight + tooltipPadY * 2 : 0
  // Precompute hover geometry for HTML tooltip placement (CSS pixels), so it
  // does not get stretched with the SVG viewBox scaling.
  let htmlTip = null
  if (hasHover && hoverIdx != null && points[hoverIdx] && wrappedLines.length > 0 && svgRef.current) {
    const hp = points[hoverIdx]
    const hx = sx(hp.x)
    const hy = sy(hp.y)
    // Calculate tooltip box position in viewBox coordinates (same math as SVG)
    let tipX
    let tipY
    if (tooltipPlacement === 'below') {
      tipX = hx - tooltipWidth / 2
      tipX = Math.max(2, Math.min(vbWidth - tooltipWidth - 2, tipX))
      const belowY = hy + 8
      const bottom = margin.top + h
      if (belowY + tooltipHeight <= bottom) {
        tipY = belowY
      } else {
        tipY = Math.max(margin.top, hy - 8 - tooltipHeight)
      }
    } else {
      const off = Math.max(0, Number(tooltipOffsetX) || 0)
      const preferRight = hx + off + tooltipWidth <= margin.left + w
      tipX = preferRight ? hx + off : hx - off - tooltipWidth
      tipX = Math.max(2, Math.min(vbWidth - tooltipWidth - 2, tipX))
      const halfBox = tooltipHeight / 2
      tipY = Math.max(margin.top, Math.min(margin.top + h - tooltipHeight, hy - halfBox))
    }

    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = rect.width / vbWidth
    const scaleY = rect.height / vbHeight
    const cssLeft = tipX * scaleX
    const cssTop = tipY * scaleY
    htmlTip = { left: cssLeft, top: cssTop, width: tooltipWidth, height: tooltipHeight }
  }

  const containerStyle = { position: 'relative', width, height }

  // Determine if the first-below-threshold marker occurs on the same day as any peak.
  let hideFirstBelow = false
  if (firstBelowThresh && Array.isArray(peakVLines) && peakVLines.length > 0) {
    const firstBelowDay = dayKey(firstBelowThresh.x)
    if (firstBelowDay) {
      for (const pk of peakVLines) {
        if (!pk) continue
        if (dayKey(pk.x) === firstBelowDay) { hideFirstBelow = true; break }
      }
    }
  }

  // Compute the "days since previous peak" for the first-below-threshold marker
  // only if we are going to show it. We look for the last qualifying peak at or before the drop timestamp.
  let firstBelowDaysSincePrevPeak = null
  if (!hideFirstBelow && firstBelowThresh && Array.isArray(peakVLines) && peakVLines.length > 0) {
    const dropTs = firstBelowThresh.x
    let prevPeakTs = null
    for (let i = 0; i < peakVLines.length; i++) {
      const pk = peakVLines[i]
      if (!pk) continue
      if (isFinite(pk.x) && pk.x <= dropTs) {
        prevPeakTs = pk.x
      } else if (isFinite(pk.x) && pk.x > dropTs) {
        break
      }
    }
    const msPerDay = 24 * 60 * 60 * 1000
    // Use whole day difference between local calendar dates
    const a = (prevPeakTs != null && isFinite(prevPeakTs)) ? startOfDay(prevPeakTs) : NaN
    const b = startOfDay(dropTs)
    const days = (isFinite(a) && isFinite(b)) ? Math.max(0, Math.floor((b - a) / msPerDay)) : 0
    firstBelowDaysSincePrevPeak = days
  }

  return (
    <div style={containerStyle} ref={containerRef}>
      <svg
        ref={svgRef}
        width={typeof width === 'number' ? width : '100%'}
        height={height}
        role="img"
        aria-label="sparkline"
        viewBox={`0 0 ${vbWidth} ${vbHeight}`}
        // Use the default meet behavior so proportions are preserved and the
        // geometry matches the measured pixel width of the container.
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', position: 'absolute', inset: 0 }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
      {/* First-below-threshold vertical marker (hidden if on same day as a peak) */}
      {firstBelowThresh && !hideFirstBelow && (
        <g>
          <line
            x1={sx(firstBelowThresh.x)}
            x2={sx(firstBelowThresh.x)}
            y1={margin.top}
            y2={margin.top + h}
            stroke={effectiveTheme === 'dark' ? '#60a5fa' : '#2563eb'}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            opacity={0.95}
          />
          {firstBelowDaysSincePrevPeak != null && (
            <text
              x={sx(firstBelowThresh.x)}
              y={Math.min(margin.top + h + 12, vbHeight - 2)}
              textAnchor="middle"
              fontSize={10}
              fill={effectiveTheme === 'dark' ? '#60a5fa' : '#2563eb'}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {`${firstBelowDaysSincePrevPeak}d`}
            </text>
          )}
        </g>
      )}
      {/* Vertical peak markers (watering hints) + date labels and days since previous peak */}
      {showPeakVLines && peakVLines.length > 0 && peakVLines.map((m, idx) => {
        const px = sx(m.x)
        const color = effectiveTheme === 'dark' ? '#f59e0b' : '#d97706' // amber tones for lines
        // Determine threshold Y (if the caller provided a reference line labeled "Thresh")
        let threshY = threshYValue
        // Color rule for labels based on previous value vs threshold with a 10% band:
        // - If the previous value is above the threshold → green.
        // - Else, if it's within 10% of maxWaterG below the threshold → green.
        // - Otherwise → default amber.
        // Note: if maxWaterG is not available, we fall back to the strict comparison (above only).
        const green = effectiveTheme === 'dark' ? '#22c55e' : '#16a34a'
        let labelColor = (effectiveTheme === 'dark' ? '#f59e0b' : '#d97706')
        if (threshY != null && isFinite(threshY) && isFinite(m?.prevY)) {
          const prev = m.prevY
          if (prev > threshY) {
            labelColor = green
          } else if (isFinite(maxWaterG) && maxWaterG > 0) {
            const band = 0.10 * maxWaterG
            if (prev >= (threshY - band)) labelColor = green
          }
        }
        return (
          <g key={`pv-${idx}`}>
            <line
              x1={px}
              x2={px}
              y1={margin.top}
              y2={margin.top + h}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.9}
            />
            {showPeakVLineLabels && (
              <>
                <text
                  x={px}
                  y={Math.min(margin.top + h + 10, vbHeight - 12)}
                  fontSize={9}
                  fill={labelColor}
                  textAnchor="middle"
                >
                  {m.label}
                </text>
                <text
                  x={px}
                  y={Math.min(margin.top + h + 20, vbHeight - 2)}
                  fontSize={9}
                  fill={labelColor}
                  textAnchor="middle"
                >
                  ({m.daysSince}d)
                </text>
              </>
            )}
          </g>
        )
      })}
      {/* Horizontal reference lines (dashed), drawn behind the series for visibility */}
      {Array.isArray(refLines) && refLines.map((rl, idx) => {
        if (!rl || !isFinite(rl.y)) return null
        const y = sy(rl.y)
        const color = rl.color || (effectiveTheme === 'dark' ? '#6b7280' : '#9ca3af')
        const dash = rl.dash || '4 3'
        const label = rl.label
        return (
          <g key={`ref-${idx}`}>
            <line x1={margin.left} x2={margin.left + w} y1={y} y2={y} stroke={color} strokeDasharray={dash} strokeWidth={1} />
            {label && (
              <text x={margin.left + 4} y={Math.max(margin.top + 8, Math.min(margin.top + h - 4, y - 2))} fontSize={10} fill={color}>
                {label}
              </text>
            )}
          </g>
        )
      })}
      {area && (
        <path d={area} fill={defaultFill} stroke="none" />
      )}
      <path d={path} fill="none" stroke={defaultStroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {showPoints && points.map((p, i) => (
        <g key={`pt-${i}`}>
          <circle cx={sx(p.x)} cy={sy(p.y)} r={2} fill={defaultStroke}>
            <title>{p.title || ''}</title>
          </circle>
        </g>
      ))}
      {dotLast && last && (
        <circle cx={sx(last.x)} cy={sy(last.y)} r={3} fill={defaultStroke} />
      )}
      {/* Interactive hover elements (guide + focus dot only; tooltip rendered as HTML) */}
      {hasHover && hoverIdx != null && points[hoverIdx] && (() => {
        const hp = points[hoverIdx]
        const hx = sx(hp.x)
        const hy = sy(hp.y)
        const guideColor = effectiveTheme === 'dark' ? '#6b7280' : '#9ca3af'
        const bgFill = effectiveTheme === 'dark' ? '#111827' : '#ffffff'
        return (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={margin.top} y2={margin.top + h} stroke={guideColor} strokeDasharray="3 3" strokeWidth={1} />
            <circle cx={hx} cy={hy} r={3} fill={defaultStroke} stroke={bgFill} strokeWidth={1} />
          </g>
        )
      })()}
      </svg>
      {/* HTML tooltip overlay to avoid SVG stretching */}
      {htmlTip && (
        <div
          style={{
            position: 'absolute',
            left: htmlTip.left,
            top: htmlTip.top,
            width: htmlTip.width,
            minWidth: minTooltipW,
            maxWidth: maxTooltipW,
            background: effectiveTheme === 'dark' ? '#111827' : '#ffffff',
            color: effectiveTheme === 'dark' ? '#e5e7eb' : '#111827',
            border: `1px solid ${effectiveTheme === 'dark' ? '#374151' : '#e5e7eb'}`,
            borderRadius: 4,
            padding: `${tooltipPadY}px ${tooltipPadX}px`,
            boxShadow: effectiveTheme === 'dark' ? '0 2px 8px rgba(0,0,0,0.6)' : '0 2px 8px rgba(0,0,0,0.1)',
            pointerEvents: 'none',
            fontSize: tooltipFontSize,
            lineHeight: `${tooltipLineHeight}px`,
            whiteSpace: 'pre',
          }}
        >
          {wrappedLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  )
}
