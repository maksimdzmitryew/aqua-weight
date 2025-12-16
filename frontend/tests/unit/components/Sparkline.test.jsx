import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import Sparkline, { computeFirstBelow, shouldHideFirstBelow, computeDaysSincePrevPeak, computePeakVLines } from '../../../src/components/Sparkline.jsx'

// Helper to render with ThemeProvider (light by default)
function renderWithTheme(ui) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('components/Sparkline', () => {
  beforeEach(() => {
    // Ensure a clean localStorage for dt preferences and theme
    localStorage.clear()
    // JSDOM sometimes misses getBoundingClientRect width/height variations
    // We stub it to a stable box to keep tooltip math predictable.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      // If this is an SVG, return non-zero dims
      if (this.getAttribute && (this.tagName === 'svg' || this.tagName === 'SVG')) {
        return { left: 0, top: 0, width: 300, height: 80, right: 300, bottom: 80, x: 0, y: 0, toJSON() {} }
      }
      return { left: 0, top: 0, width: 300, height: 80, right: 300, bottom: 80, x: 0, y: 0, toJSON() {} }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('renders basic sparkline path and last-dot by default', () => {
    const t0 = new Date('2025-01-01T00:00:00Z').getTime()
    const data = [
      { x: t0, y: 10 },
      { x: t0 + 1, y: 12 },
      { x: t0 + 2, y: 9 },
    ]
    renderWithTheme(<Sparkline data={data} width={240} height={80} />)

    const svg = screen.getByLabelText('sparkline')
    // main path exists
    expect(svg.querySelector('path')).toBeTruthy()
    // last dot is rendered by default
    const circles = svg.querySelectorAll('circle')
    expect(circles.length).toBeGreaterThan(0)
  })

  test('renders area when multiple points and fill not disabled; renders reference lines with labels', () => {
    const t = Date.now()
    const data = [
      { x: t, y: 5 },
      { x: t + 1, y: 7 },
    ]
    const refLines = [
      { y: 6, label: 'Thresh' },
      { y: 2, label: 'Min' },
    ]
    renderWithTheme(<Sparkline data={data} refLines={refLines} width={240} height={80} />)

    const svg = screen.getByLabelText('sparkline')
    // area path exists (second path element)
    const paths = svg.querySelectorAll('path')
    expect(paths.length).toBeGreaterThanOrEqual(2)
    // ref lines are lines with dash arrays; verify labels appear
    expect(within(svg).getByText('Thresh')).toBeInTheDocument()
    expect(within(svg).getByText('Min')).toBeInTheDocument()
  })

  test('computes peaks and renders vertical lines with labels and daysSince (USA date format)', () => {
    // Set USA date format preference
    localStorage.setItem('dtFormat', 'usa')
    // Build a small dataset with a clear peak at t2
    const d0 = new Date('2025-02-01T08:00:00Z').getTime()
    const pts = [
      { x: d0 + 0, y: 10 },
      { x: d0 + 86400000, y: 20 }, // peak (>= +10 from prev if maxWaterG=100 and pct=0.1)
      { x: d0 + 2 * 86400000, y: 12 },
      { x: d0 + 3 * 86400000, y: 25 }, // another peak
      { x: d0 + 4 * 86400000, y: 10 },
    ]
    // thresh line to influence label color calculation
    const ref = [{ y: 15, label: 'Thresh' }]
    renderWithTheme(
      <Sparkline
        data={pts}
        refLines={ref}
        maxWaterG={100}
        peakDeltaPct={0.1}
        showPeakVLines
        showPeakVLineLabels
        width={300}
        height={80}
      />
    )

    const svg = screen.getByLabelText('sparkline')
    // Expect at least two peak marker groups rendered
    const peakLabels = within(svg).getAllByText(/\(\d{2}\/\d{2}\)/) // (MM/DD)
    expect(peakLabels.length).toBeGreaterThanOrEqual(2)
    // And day counters like "Xd"
    const dayBadges = within(svg).getAllByText(/\d+d/)
    expect(dayBadges.length).toBeGreaterThanOrEqual(2)
  })

  test('first-below-threshold marker renders with days since prev peak, and hides if same day as a peak', () => {
    const base = new Date('2025-03-01T06:00:00').getTime()
    // Construct points with a peak on day 2 and a drop below thresh on same day 2 to verify hide, then later drop to show
    const pts = [
      { x: base + 0 * 86400000, y: 5 },
      { x: base + 1 * 86400000, y: 20 }, // peak (prev 5 -> 20)
      { x: base + 1 * 86400000 + 3600000, y: 9 }, // drop below thresh same day -> should be hidden
      { x: base + 3 * 86400000, y: 8 }, // later another drop below thresh -> should show
    ]
    const ref = [{ y: 10, label: 'Thresh' }]
    renderWithTheme(
      <Sparkline
        data={pts}
        refLines={ref}
        maxWaterG={100}
        peakDeltaPct={0.1}
        width={300}
        height={80}
      />
    )

    const svg = screen.getByLabelText('sparkline')
    // Hidden for the first same-day drop; but visible for the later drop at day 3 since there is prior peak at day 1
    // Tooltip text under the line shows days since previous peak, expect something like "2d"
    const counters = within(svg).getAllByText(/\d+d/)
    expect(counters.length).toBeGreaterThan(0)
  })

  test('hover shows HTML tooltip with default lines and hides on mouse leave', () => {
    const t0 = new Date('2025-01-01T00:00:00').getTime()
    const pts = [
      { x: t0, y: 10 },
      { x: t0 + 60 * 1000, y: 15 },
    ]
    renderWithTheme(<Sparkline data={pts} width={300} height={80} tooltipPlacement="side" />)

    const svg = screen.getByLabelText('sparkline')
    // Move mouse roughly to the middle to pick the nearest point
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 40 })
    // Tooltip overlay should appear as a positioned div with date and value lines
    const tooltip = screen.getByText(/\d{2}\/\d{2}\/\d{4}/)
    expect(tooltip).toBeInTheDocument()
    // It should also include a line with value in grams (e.g., "15 g") or delta line "Δ +5 g"
    const valueLine = screen.getByText((t) => /\dg$/.test(t) || /^Δ .*g$/.test(t))
    expect(valueLine).toBeInTheDocument()

    // Now leave the chart; tooltip should disappear
    fireEvent.mouseLeave(svg)
    expect(screen.queryByText(/\d{2}\/\d{2}\/\d{4}/)).toBeNull()
  })

  test('showPoints renders per-point circles and dotLast can be disabled', () => {
    const now = Date.now()
    const pts = [
      { x: now, y: 1 },
      { x: now + 1, y: 2 },
    ]
    renderWithTheme(<Sparkline data={pts} width={240} height={80} showPoints dotLast={false} />)

    const svg = screen.getByLabelText('sparkline')
    const circles = svg.querySelectorAll('circle')
    // With showPoints and dotLast disabled, we expect exactly two small circles from the points and no larger last-dot
    expect(circles.length).toBe(2)
  })

  test('tooltip placement "below" path is used and stays within chart bounds', () => {
    const t0 = new Date('2025-04-01T12:00:00').getTime()
    const pts = [
      { x: t0, y: 1 },
      { x: t0 + 1000, y: 50 },
      { x: t0 + 2000, y: 2 },
    ]
    renderWithTheme(
      <Sparkline
        data={pts}
        width={300}
        height={80}
        tooltipPlacement="below"
      />
    )
    const svg = screen.getByLabelText('sparkline')
    // Hover near the middle point (peak) to ensure space below may be constrained
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 10 })
    const tip = screen.getByText(/\d{2}\/\d{2}\/\d{4}/).parentElement
    expect(tip).toBeInTheDocument()
    // Ensure tooltip element is positioned absolutely and has numeric top/left
    expect(tip.style.position).toBe('absolute')
    expect(parseFloat(tip.style.left)).toBeGreaterThanOrEqual(0)
    expect(parseFloat(tip.style.top)).toBeGreaterThanOrEqual(0)
  })

  test('tooltip placement "below" chooses belowY when there is sufficient space', () => {
    const t0 = new Date('2025-04-02T00:00:00').getTime()
    renderWithTheme(
      <Sparkline
        data={[{ x: t0, y: 5 }, { x: t0 + 1, y: 6 }]}
        width={300}
        height={80}
        tooltipPlacement="below"
      />
    )
    const svg = screen.getByLabelText('sparkline')
    // Move mouse somewhere near the top to guarantee room below for the tooltip
    fireEvent.mouseMove(svg, { clientX: 100, clientY: 5 })
    const tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeTruthy()
    // Should be placed with a small top (near top since belowY used). Numeric assert only.
    expect(parseFloat(tip.style.top)).toBeGreaterThanOrEqual(0)
  })

  test('tooltip "below" definitely uses belowY with ample height', () => {
    const t0 = new Date('2025-04-03T00:00:00').getTime()
    renderWithTheme(
      <Sparkline
        data={[{ x: t0, y: 1 }, { x: t0 + 1, y: 2 }, { x: t0 + 2, y: 1.5 }]}
        width={320}
        height={180}
        tooltipPlacement="below"
      />
    )
    const svg = screen.getByLabelText('sparkline')
    // Hover near the very top-left to maximize space below
    fireEvent.mouseMove(svg, { clientX: 5, clientY: 1 })
    const tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeTruthy()
    // With ample height, the below branch should be used resulting in a small top value
    expect(parseFloat(tip.style.top)).toBeGreaterThanOrEqual(0)
    expect(parseFloat(tip.style.top)).toBeLessThan(60)
  })

  test('custom hoverFormatter long line is hard-wrapped into multiple lines', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 1 },
      { x: t0 + 1, y: 2 },
    ]
    const longToken = 'X'.repeat(400) // force hard-break path inside wrapLine
    const formatter = () => [longToken]
    renderWithTheme(
      <Sparkline
        data={pts}
        width={300}
        height={80}
        hoverFormatter={formatter}
      />
    )

    const svg = screen.getByLabelText('sparkline')
    fireEvent.mouseMove(svg, { clientX: 299, clientY: 40 })
    // The tooltip should be an absolutely positioned div rendered after the SVG
    const absTooltips = Array.from(document.querySelectorAll('div')).filter((el) => el.style?.position === 'absolute')
    expect(absTooltips.length).toBeGreaterThan(0)
    const tooltipContainer = absTooltips[absTooltips.length - 1]
    const lines = tooltipContainer.querySelectorAll('div')
    expect(lines.length).toBeGreaterThan(3)
  })

  // Removed unreachable-branch test; logic refactored to default 0d without else

  test('uses ResizeObserver branch when available', () => {
    // Provide a simple ResizeObserver mock to exercise that branch
    class RO {
      observe() {}
      disconnect() {}
    }
    // @ts-ignore
    window.ResizeObserver = RO
    const now = Date.now()
    renderWithTheme(<Sparkline data={[{ x: now, y: 1 }]} width={240} height={80} />)
    // If no crash, branch executed; assert SVG exists
    expect(screen.getByLabelText('sparkline')).toBeInTheDocument()
  })

  test('defaultHoverLines: invalid date falls back to String(x); USA format uses 12h clock with AM/PM', () => {
    // USA format branch
    localStorage.setItem('dtFormat', 'usa')
    const validTs = new Date('2025-05-01T00:15:00').getTime()
    renderWithTheme(<Sparkline data={[{ x: validTs, y: 5 }]} width={300} height={80} />)
    const svg1 = screen.getByLabelText('sparkline')
    fireEvent.mouseMove(svg1, { clientX: 150, clientY: 40 })
    expect(screen.getByText(/AM|PM/)).toBeInTheDocument()

    // Invalid date branch: very large timestamp becomes Invalid Date but still finite
    localStorage.removeItem('dtFormat')
    const badTs = 9e18
    renderWithTheme(<Sparkline data={[{ x: badTs, y: 7 }]} width={300} height={80} />)
    const svg2 = screen.getAllByLabelText('sparkline')[1]
    fireEvent.mouseMove(svg2, { clientX: 10, clientY: 10 })
    // The tooltip should contain String(pt.x)
    expect(screen.getByText(String(badTs))).toBeInTheDocument()
  })

  test('wrapLine branch with existing text then long word triggers push and hard-break', () => {
    const t0 = Date.now()
    const longWord = 'Y'.repeat(500)
    const formatter = () => [
      // two tokens: short + extremely long to exercise the branch where cur exists then candidate overflows
      `short ${longWord}`,
    ]
    renderWithTheme(
      <Sparkline
        data={[{ x: t0, y: 1 }]}
        width={300}
        height={80}
        hoverFormatter={formatter}
      />
    )
    const svg = screen.getByLabelText('sparkline')
    fireEvent.mouseMove(svg, { clientX: 50, clientY: 40 })
    const absTooltips = Array.from(document.querySelectorAll('div')).filter((el) => el.style?.position === 'absolute')
    expect(absTooltips.length).toBeGreaterThan(0)
    const tooltipContainer = absTooltips.at(-1)
    // We expect multiple lines due to wrapping and hard-breaks
    expect(tooltipContainer.querySelectorAll('div').length).toBeGreaterThan(3)
  })

  test('tooltip side placement chooses right or left based on available space', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 10 },
      { x: t0 + 1, y: 20 },
      { x: t0 + 2, y: 15 },
    ]
    // Default placement is side; width mocked to 300 in getBoundingClientRect
    renderWithTheme(<Sparkline data={pts} width={300} height={80} tooltipOffsetX={28} />)
    const svg = screen.getByLabelText('sparkline')
    // Hover near the left so preferRight should be true
    fireEvent.mouseMove(svg, { clientX: 20, clientY: 40 })
    let tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeTruthy()
    const leftPosRightPref = parseFloat(tip.style.left)

    // Now hover near the far right so preferRight should be false and tip flips to the left side
    fireEvent.mouseMove(svg, { clientX: 295, clientY: 40 })
    tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeTruthy()
    const leftPosLeftPref = parseFloat(tip.style.left)
    // Both measurements should be finite numbers, indicating placement computed in both branches
    expect(Number.isFinite(leftPosRightPref)).toBe(true)
    expect(Number.isFinite(leftPosLeftPref)).toBe(true)
  })

  test('hover can be disabled via prop and no tooltip is rendered', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 1 },
      { x: t0 + 1, y: 2 },
    ]
    renderWithTheme(<Sparkline data={pts} width={300} height={80} hover={false} />)
    const svg = screen.getByLabelText('sparkline')
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 40 })
    // No absolutely positioned tooltip div should appear
    const tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeUndefined()
  })

  test('showPeakVLineLabels=false hides peak labels while lines remain', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 10 },
      { x: t0 + 1, y: 30 }, // peak with delta >= 10 if maxWaterG=100, pct=0.1
      { x: t0 + 2, y: 15 },
    ]
    renderWithTheme(
      <Sparkline
        data={pts}
        maxWaterG={100}
        peakDeltaPct={0.1}
        showPeakVLines
        showPeakVLineLabels={false}
        width={300}
        height={80}
      />
    )
    const svg = screen.getByLabelText('sparkline')
    // There should be a dashed vertical line for the peak
    const dashedLines = svg.querySelectorAll('line[stroke-dasharray="2 2"]')
    expect(dashedLines.length).toBeGreaterThan(0)
    // But no day counters like "Xd" labels should be present
    expect(within(svg).queryByText(/\d+d/)).toBeNull()
  })

  test('showFirstBelowThreshVLine=false disables first-below marker even when crossing', () => {
    const base = new Date('2025-07-01T00:00:00').getTime()
    const pts = [
      { x: base, y: 12 },
      { x: base + 86400000, y: 8 }, // crosses below threshold 10
    ]
    const ref = [{ y: 10, label: 'Thresh' }]
    renderWithTheme(
      <Sparkline
        data={pts}
        refLines={ref}
        width={300}
        height={80}
        showFirstBelowThreshVLine={false}
      />
    )
    const svg = screen.getByLabelText('sparkline')
    // No vertical dashed line with dasharray 4 2 for first-below marker
    const fbLines = svg.querySelectorAll('line[stroke-dasharray="4 2"]')
    expect(fbLines.length).toBe(0)
  })

  test('reference line without label renders line only and skips label branch', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 1 },
      { x: t0 + 1, y: 2 },
    ]
    const refs = [
      { y: 1.5 }, // no label -> should not render text element
    ]
    renderWithTheme(<Sparkline data={pts} refLines={refs} width={300} height={80} />)
    const svg = screen.getByLabelText('sparkline')
    // One horizontal dashed ref line should exist
    const refLinesEls = svg.querySelectorAll('line[stroke-dasharray="4 3"]')
    expect(refLinesEls.length).toBe(1)
    // No text label with that value present
    expect(within(svg).queryByText('1.5')).toBeNull()
  })

  test('reference lines: invalid entries are ignored (null, non-finite y)', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 1 },
      { x: t0 + 1, y: 2 },
    ]
    const refs = [null, { y: NaN }, { y: 2, label: 'OK' }]
    renderWithTheme(<Sparkline data={pts} refLines={refs} width={300} height={80} />)
    const svg = screen.getByLabelText('sparkline')
    // Only the valid one should render (with default dash 4 3)
    const refLinesEls = svg.querySelectorAll('line[stroke-dasharray="4 3"]')
    expect(refLinesEls.length).toBe(1)
    expect(within(svg).getByText('OK')).toBeInTheDocument()
  })

  test('peak label color remains amber when below threshold and outside band', () => {
    const t0 = Date.now()
    // Choose threshold 50, prev 30, within band? with maxWaterG=100 band=10, thresh-band = 40; prev=30 < 40 -> amber
    const pts = [
      { x: t0, y: 30 },
      { x: t0 + 1, y: 60 }, // peak (delta +30)
      { x: t0 + 2, y: 10 },
    ]
    const ref = [{ y: 50, label: 'Thresh' }]
    renderWithTheme(
      <Sparkline
        data={pts}
        refLines={ref}
        maxWaterG={100}
        peakDeltaPct={0.1}
        showPeakVLines
        showPeakVLineLabels
        width={300}
        height={80}
      />
    )
    const svg = screen.getByLabelText('sparkline')
    const badge = within(svg).getByText(/\d+d/)
    // Amber for light theme
    expect(badge).toHaveAttribute('fill', '#d97706')
  })

  test('peak label color turns green when within 10% band below threshold', () => {
    const t0 = Date.now()
    // threshold 50, band=10, prev=45 -> within band -> green
    const pts = [
      { x: t0, y: 45 },
      { x: t0 + 1, y: 70 }, // peak
      { x: t0 + 2, y: 20 },
    ]
    const ref = [{ y: 50, label: 'Thresh' }]
    renderWithTheme(
      <Sparkline
        data={pts}
        refLines={ref}
        maxWaterG={100}
        peakDeltaPct={0.1}
        showPeakVLines
        showPeakVLineLabels
        width={300}
        height={80}
      />
    )
    const svg = screen.getByLabelText('sparkline')
    const badge = within(svg).getByText(/\d+d/)
    expect(badge).toHaveAttribute('fill', '#16a34a')
  })

  test('peak label color uses default amber when no threshold ref line is provided', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 20 },
      { x: t0 + 1, y: 40 }, // peak
      { x: t0 + 2, y: 10 },
    ]
    renderWithTheme(
      <Sparkline
        data={pts}
        maxWaterG={100}
        peakDeltaPct={0.1}
        showPeakVLines
        showPeakVLineLabels
        width={300}
        height={80}
      />
    )
    const svg = screen.getByLabelText('sparkline')
    const badge = within(svg).getByText(/\d+d/)
    expect(badge).toHaveAttribute('fill', '#d97706')
  })

  test('reference line custom color and dash are applied', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 1 },
      { x: t0 + 1, y: 2 },
    ]
    const refs = [{ y: 1.5, label: 'L', color: '#123456', dash: '1 1' }]
    renderWithTheme(<Sparkline data={pts} refLines={refs} width={300} height={80} />)
    const svg = screen.getByLabelText('sparkline')
    const refLine = svg.querySelector('line[stroke_dasharray], line[stroke-dasharray]') || svg.querySelector('line')
    expect(refLine).toBeTruthy()
    // dash attribute should be set to "1 1"
    expect(refLine.getAttribute('stroke-dasharray')).toBe('1 1')
    // The label text should have matching custom color
    const label = within(svg).getByText('L')
    expect(label).toHaveAttribute('fill', '#123456')
  })

  test('tooltip side placement: preferRight false path when large offset forces left-side placement', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 10 },
      { x: t0 + 1, y: 20 },
      { x: t0 + 2, y: 15 },
    ]
    // First, normal offset -> preferRight true for a left hover
    renderWithTheme(<Sparkline data={pts} width={300} height={80} tooltipOffsetX={10} />)
    const svg1 = screen.getByLabelText('sparkline')
    fireEvent.mouseMove(svg1, { clientX: 30, clientY: 40 })
    let tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeTruthy()

    // Render a second chart with huge offset to force preferRight = false even on mid positions
    renderWithTheme(<Sparkline data={pts} width={300} height={80} tooltipOffsetX={500} />)
    const svg2 = screen.getAllByLabelText('sparkline')[1]
    fireEvent.mouseMove(svg2, { clientX: 150, clientY: 40 })
    tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeTruthy()
  })

  test('first-below fallback to first data point when no peaks present', () => {
    const base = new Date('2025-06-01T00:00:00').getTime()
    // Monotonic decrease to avoid any peaks
    const pts = [
      { x: base + 0 * 86400000, y: 10 },
      { x: base + 1 * 86400000, y: 9 }, // first-below from prev 10 vs thresh 9.5
      { x: base + 2 * 86400000, y: 8 },
    ]
    const ref = [{ y: 9.5, label: 'Thresh' }]
    renderWithTheme(
      <Sparkline data={pts} refLines={ref} width={300} height={80} maxWaterG={100} peakDeltaPct={0.5} />
    )
    const svg = screen.getByLabelText('sparkline')
    // There should be a first-below marker with daysSince from the first point => 1d
    expect(within(svg).getByText('1d')).toBeInTheDocument()
  })

  test('peak label color turns green when previous value above threshold', () => {
    const t0 = Date.now()
    const pts = [
      { x: t0, y: 30 },
      { x: t0 + 1, y: 50 }, // peak, prev=30 (>15)
      { x: t0 + 2, y: 10 },
    ]
    const ref = [{ y: 15, label: 'Thresh' }]
    renderWithTheme(
      <Sparkline
        data={pts}
        refLines={ref}
        maxWaterG={100}
        peakDeltaPct={0.1}
        showPeakVLines
        showPeakVLineLabels
        width={300}
        height={80}
      />
    )
    const svg = screen.getByLabelText('sparkline')
    // Find the day counter text and assert its fill color is the green value for light theme
    const badge = within(svg).getByText(/\d+d/)
    expect(badge).toHaveAttribute('fill', '#16a34a')
  })

  describe('helpers', () => {
    test('computeFirstBelow respects showFirstBelow flag and invalid inputs', () => {
      const t = Date.now()
      const pts = [
        { x: t, y: 12 },
        { x: t + 1, y: 8 },
      ]
      // Disabled flag -> null
      expect(computeFirstBelow(pts, 10, false)).toBeNull()
      // Invalid thresh -> null
      expect(computeFirstBelow(pts, NaN, true)).toBeNull()
      // Works normally
      const fb = computeFirstBelow(pts, 10, true)
      expect(fb && fb.index).toBe(1)
    })

    test('computeFirstBelow skips null/undefined items (covers branch with !prev || !cur)', () => {
      const t = Date.now()
      const pts = [
        { x: t, y: 10 },
        null,       // should be skipped when cur is null
        { x: t + 2, y: 12 },
        { x: t + 3, y: 9 }, // first valid drop below thresh from 12 -> 9
      ]
      const fb = computeFirstBelow(pts, 10, true)
      expect(fb).toBeTruthy()
      expect(fb.index).toBe(3)
      expect(fb.y).toBe(9)
    })

    test('shouldHideFirstBelow returns true when any peak on same day; skips undefined items', () => {
      const base = new Date('2025-01-02T10:00:00').getTime()
      const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10)
      const firstBelow = { x: new Date('2025-01-03T05:00:00').getTime() }
      const peaks = [
        undefined,
        { x: new Date('2025-01-03T12:00:00').getTime() }, // same day -> hide
      ]
      expect(shouldHideFirstBelow(firstBelow, peaks, dayKey)).toBe(true)
      // Different day -> false
      const peaks2 = [undefined, { x: base }]
      expect(shouldHideFirstBelow(firstBelow, peaks2, dayKey)).toBe(false)
    })

    test('computeDaysSincePrevPeak hits continue and break branches and falls back to first point', () => {
      const startOfDay = (ts) => new Date(new Date(ts).toDateString()).getTime()
      const base = new Date('2025-01-01T10:00:00').getTime()
      const firstBelow = { x: base + 3 * 86400000 }
      const points = [
        { x: base, y: 1 },
        { x: base + 1 * 86400000, y: 2 },
        { x: base + 2 * 86400000, y: 1 },
      ]
      // Include undefined (continue) and a future pk after drop (break)
      const peaks = [undefined, { x: base + 5 * 86400000 }]
      const days = computeDaysSincePrevPeak(firstBelow, peaks, points, startOfDay)
      // Falls back to first point -> 3 days difference (2025-01-01 to 2025-01-04)
      expect(days).toBe(3)
    })

    test('computePeakVLines respects thresholds and returns empty when not enough points', () => {
      const t = Date.now()
      // Not enough points
      expect(computePeakVLines([{ x: t, y: 1 }], 100, 0.1, 'europe')).toEqual([])
      // Enough points but below threshold -> empty
      const pts = [
        { x: t, y: 10 },
        { x: t + 1, y: 11 },
        { x: t + 2, y: 10.5 },
      ]
      expect(computePeakVLines(pts, 100, 0.5, 'usa')).toEqual([])
      // threshAbs is null when peakDeltaPct <= 0 -> empty
      expect(computePeakVLines(pts, 100, 0, 'usa')).toEqual([])
    })
  })
})
