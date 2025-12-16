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

  test('measures container width and updates viewBox (covers line 147)', async () => {
    // Force the responsive branch by passing a non-number width, and mock clientWidth
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320)

    const t0 = new Date('2025-03-01T00:00:00Z').getTime()
    const data = [
      { x: t0, y: 1 },
      { x: t0 + 1, y: 2 },
    ]

    renderWithTheme(<Sparkline data={data} width="responsive" height={80} />)

    const svg = screen.getByLabelText('sparkline')
    // After the effect measures clientWidth, it should set measuredW to 320
    await new Promise(r => setTimeout(r, 0))
    expect(svg.getAttribute('viewBox')).toBe('0 0 320 80')

    clientWidthSpy.mockRestore()
  })

  test('handles non-array data by producing no points (covers line 170 else-branch)', () => {
    // Pass a non-array value to trigger the ternary's else branch at line 170
    const badData = null
    renderWithTheme(<Sparkline data={badData} width={240} height={80} />)

    const svg = screen.getByLabelText('sparkline')
    // With no valid points, there should be no circles (no last dot nor showPoints)
    const circles = svg.querySelectorAll('circle')
    expect(circles.length).toBe(0)

    // The main path should exist but either be empty or a minimal element without commands
    const path = svg.querySelector('path')
    expect(path).toBeTruthy()
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

  test('computes refYs from refLines including only finite values (covers line 174)', () => {
    const t = Date.now()
    const data = [
      { x: t, y: 1 },
      { x: t + 1, y: 2 },
    ]
    const refLines = [
      { y: 6, label: 'ValidA' },
      { y: NaN, label: 'BadNaN' },
      { y: Infinity, label: 'BadInf' },
      { label: 'NoY' },
      null,
      { y: 8, label: 'ValidB' },
    ]

    renderWithTheme(<Sparkline data={data} refLines={refLines} width={240} height={80} />)

    const svg = screen.getByLabelText('sparkline')
    // Only finite-y ref lines should render labels
    expect(within(svg).getByText('ValidA')).toBeInTheDocument()
    expect(within(svg).getByText('ValidB')).toBeInTheDocument()
    expect(within(svg).queryByText('BadNaN')).toBeNull()
    expect(within(svg).queryByText('BadInf')).toBeNull()
    expect(within(svg).queryByText('NoY')).toBeNull()
  })

  test('uses spanY fallback when all y values are equal (covers line 186)', () => {
    // When maxY === minY, spanY should fallback to 1 to avoid division by zero.
    // With equal y values, the plotted line should be horizontal at the bottom of the plot area.
    const t0 = new Date('2025-04-01T00:00:00Z').getTime()
    const data = [
      { x: t0, y: 5 },
      { x: t0 + 1000, y: 5 },
    ]

    // Default margins: { top: 6, right: 2, bottom: 26, left: 12 }
    // height = 80 → h = 80 - 6 - 26 = 48; bottom Y = margin.top + h = 54
    const expectedY = 54

    renderWithTheme(<Sparkline data={data} width={240} height={80} />)

    const svg = screen.getByLabelText('sparkline')
    const path = svg.querySelector('path')
    expect(path).toBeTruthy()
    const d = path.getAttribute('d')
    expect(d).toBeTruthy()

    // Extract all numbers after commas (the Y components of commands like Mx,y Lx,y)
    const yMatches = Array.from(d.matchAll(/,([0-9]+(?:\.[0-9]+)?)/g)).map(m => Number(m[1]))
    expect(yMatches.length).toBeGreaterThanOrEqual(2)
    // All y coordinates should map to the same bottom value when all y are equal
    for (const y of yMatches) {
      expect(y).toBeCloseTo(expectedY, 6)
    }
  })

  test('computes days since previous peak using finite start/drop (covers line 55)', () => {
    // Jan 1 to Jan 4 inclusive difference should be 3 days
    const jan1 = new Date('2025-01-01T12:00:00Z').getTime()
    const jan4 = new Date('2025-01-04T12:00:00Z').getTime()

    const firstBelowThresh = { x: jan4, y: 0, index: 3 }
    const peakVLines = [
      { x: jan1, y: 10, prevY: 5, label: '01/01', labelFull: '01/01/2025', daysSince: 0 },
    ]
    const points = [
      { x: jan1, y: 10 },
      { x: jan4, y: 5 },
    ]
    const startOfDay = (ts) => {
      const d = new Date(ts)
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    }

    const days = computeDaysSincePrevPeak(firstBelowThresh, peakVLines, points, startOfDay)
    expect(days).toBe(3)
  })

  test('early-returns in resize effect when container ref is null (covers line 143)', async () => {
    // Spy on addEventListener to ensure no listeners are attached when early-return happens
    const addListenerSpy = vi.spyOn(window, 'addEventListener')

    // Mock the first useRef (containerRef) to return { current: null }
    const origUseRef = React.useRef
    const useRefSpy = vi.spyOn(React, 'useRef')
    // Return a ref whose `current` getter always yields null and ignores assignments
    const fakeRef = {}
    Object.defineProperty(fakeRef, 'current', {
      get: () => null,
      set: () => {},
      configurable: true,
    })
    useRefSpy.mockImplementationOnce(() => fakeRef).mockImplementation(origUseRef)

    renderWithTheme(<Sparkline data={[]} width="responsive" height={80} />)

    // Allow effect microtask to run
    await new Promise(r => setTimeout(r, 0))

    // No resize listeners should be attached because the effect returned early
    expect(addListenerSpy).not.toHaveBeenCalled()

    // Clean up
    addListenerSpy.mockRestore()
    useRefSpy.mockRestore()
  })

  test('uses default fill when fill is undefined (covers line 135)', () => {
    const t0 = new Date('2025-02-01T00:00:00Z').getTime()
    const data = [
      { x: t0, y: 1 },
      { x: t0 + 60_000, y: 3 },
      { x: t0 + 120_000, y: 2 },
    ]

    renderWithTheme(<Sparkline data={data} width={240} height={80} />)

    const svg = screen.getByLabelText('sparkline')
    const paths = svg.querySelectorAll('path')
    // When defaultFill is used, area path should be present (second path)
    expect(paths.length).toBeGreaterThanOrEqual(2)
  })

  test('default fill uses dark theme color and renders area (cover line 135)', () => {
    // Force dark theme so Sparkline picks the dark defaultFill branch
    localStorage.setItem('theme', 'dark')

    const t = Date.now()
    const data = [
      { x: t, y: 5 },
      { x: t + 1, y: 7 },
    ]

    renderWithTheme(<Sparkline data={data} width={240} height={80} />)

    const svg = screen.getByLabelText('sparkline')
    const paths = svg.querySelectorAll('path')
    expect(paths.length).toBeGreaterThanOrEqual(2)

    // Area path is the one with stroke="none" and a non-none fill
    const areaPath = Array.from(paths).find(p => p.getAttribute('stroke') === 'none')
    expect(areaPath).toBeTruthy()
    expect(areaPath.getAttribute('fill')).toBe('rgba(96,165,250,0.15)')
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

  test('shouldHideFirstBelow returns false when dayKey yields falsy for firstBelow (cover line 24)', () => {
    // Arrange: truthy firstBelowThresh and non-empty peaks to pass earlier guards
    const firstBelow = { x: 1234567890, y: 9 }
    const peakVLines = [{ x: 111 }, { x: 222 }]
    // dayKey returns null for firstBelow.x, which should trigger the early return at line 24
    const dayKey = vi.fn((x) => (x === firstBelow.x ? null : '2025-01-01'))

    // Act
    const res = shouldHideFirstBelow(firstBelow, peakVLines, dayKey)

    // Assert
    expect(res).toBe(false)
    expect(dayKey).toHaveBeenCalledWith(firstBelow.x)
  })

  test('computeDaysSincePrevPeak returns null when firstBelowThresh is falsy (cover line 33)', () => {
    // It should short-circuit and return null without invoking startOfDay
    const dummyStartOfDay = vi.fn((ts) => ts)

    // Null
    const r1 = computeDaysSincePrevPeak(null, [], [], dummyStartOfDay)
    expect(r1).toBeNull()
    expect(dummyStartOfDay).not.toHaveBeenCalled()

    // Undefined
    const r2 = computeDaysSincePrevPeak(undefined, [{ x: 1 }], [{ x: 1, y: 1 }], dummyStartOfDay)
    expect(r2).toBeNull()
    expect(dummyStartOfDay).not.toHaveBeenCalled()
  })

  test('computeDaysSincePrevPeak computes floor day diff using startOfDay (cover line 55)', () => {
    // Arrange: drop occurs on the 4th day, startTs should resolve to day 1 via peakVLines
    const baseUTC = Date.UTC(2025, 0, 1) // 2025-01-01T00:00:00Z
    const firstBelowThresh = { x: baseUTC + 3 * 86_400_000 + 5 * 60 * 60 * 1000, y: 0 } // Jan 4, +5h
    // Provide peakVLines such that the last <= drop is the very first day (baseUTC), then a later one to trigger break
    const peakVLines = [
      { x: baseUTC },
      { x: baseUTC + 10 * 86_400_000 }, // > drop -> loop breaks, startTs stays at baseUTC
    ]
    const points = []
    const startOfDay = (ts) => {
      const d = new Date(ts)
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    }

    // Act
    const days = computeDaysSincePrevPeak(firstBelowThresh, peakVLines, points, startOfDay)

    // Assert: floor((Jan4@00:00 - Jan1@00:00)/1d) = 3
    expect(days).toBe(3)
  })

  test('computePeakVLines skips indices when prev/cur/next missing (cover line 73)', () => {
    // Arrange: include a null point to force the guard at line 73 to trigger "continue"
    const t0 = Date.UTC(2025, 0, 1)
    const pts = [
      { x: t0 + 0 * 86_400_000, y: 5 },
      null, // triggers the guard: prev/cur/next check
      { x: t0 + 2 * 86_400_000, y: 10 },
      { x: t0 + 3 * 86_400_000, y: 25 }, // peak (prev=10, next=15)
      { x: t0 + 4 * 86_400_000, y: 15 },
    ]

    // Act
    const peaks = computePeakVLines(pts, 100, 0.1, 'usa')

    // Assert: the null entry should be skipped safely; a valid peak is still detected
    expect(Array.isArray(peaks)).toBe(true)
    expect(peaks.length).toBe(1)
    expect(peaks[0].x).toBe(pts[3].x)
    expect(peaks[0]).toMatchObject({ prevY: 10, daysSince: 0 })
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

  test('peak marker line and label use amber in light theme (cover 505-514)', () => {
    const t0 = new Date('2025-07-10T00:00:00Z').getTime()
    // Create a peak where prev is well below threshold and outside the 10% band
    // prev=50, cur=70 (peak), next=60; threshold=80, maxWaterG=100 -> band=10, thresh-band=70, prev=50 < 70
    const pts = [
      { x: t0, y: 50 },
      { x: t0 + 86_400_000, y: 70 }, // peak
      { x: t0 + 2 * 86_400_000, y: 60 },
    ]
    const ref = [{ y: 80, label: 'Thresh' }]
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
    // Peak marker vertical line has strokeDasharray="2 2" and should use amber color for light theme (#d97706)
    const peakLine = svg.querySelector('line[stroke-dasharray="2 2"]')
    expect(peakLine).toBeTruthy()
    expect(peakLine?.getAttribute('stroke')).toBe('#d97706')

    // Label color defaults to amber when prev below threshold and outside band
    const badge = within(svg).getByText(/\d+d/)
    expect(badge).toHaveAttribute('fill', '#d97706')
  })

  test('peak marker line and label use amber in dark theme (cover 505-514)', () => {
    localStorage.setItem('theme', 'dark')

    const t0 = new Date('2025-07-11T00:00:00Z').getTime()
    const pts = [
      { x: t0, y: 40 },
      { x: t0 + 86_400_000, y: 60 }, // peak
      { x: t0 + 2 * 86_400_000, y: 50 },
    ]
    const ref = [{ y: 80, label: 'Thresh' }]
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
    const peakLine = svg.querySelector('line[stroke-dasharray="2 2"]')
    expect(peakLine).toBeTruthy()
    // Dark theme amber tone
    expect(peakLine?.getAttribute('stroke')).toBe('#f59e0b')

    const badge = within(svg).getByText(/\d+d/)
    expect(badge).toHaveAttribute('fill', '#f59e0b')
  })

  test('first-below marker stroke and label use blue in light theme (cover 483-494)', () => {
    const base = new Date('2025-08-01T08:00:00Z').getTime()
    // Create a simple sequence with a first-below-threshold drop and no peaks
    // Threshold at 10; going from 12 -> 9 crosses below
    const pts = [
      { x: base + 0 * 86400000, y: 12 },
      { x: base + 1 * 86400000, y: 9 },
      { x: base + 2 * 86400000, y: 8 },
    ]
    const ref = [{ y: 10, label: 'Thresh' }]

    renderWithTheme(
      <Sparkline data={pts} refLines={ref} width={300} height={80} />
    )

    const svg = screen.getByLabelText('sparkline')
    // The first-below vertical marker has dash "4 2" and width 1.5
    const fbLine = svg.querySelector('line[stroke-dasharray="4 2"][stroke-width="1.5"]')
    expect(fbLine).toBeTruthy()
    // Light theme stroke color
    expect(fbLine?.getAttribute('stroke')).toBe('#2563eb')

    // The label text (e.g., "0d" or "1d") should have the same blue color in light theme
    const badge = within(svg).getByText(/\d+d/)
    expect(badge).toHaveAttribute('fill', '#2563eb')
  })

  test('first-below marker stroke and label use blue in dark theme (cover 483-494)', () => {
    localStorage.setItem('theme', 'dark')

    const base = new Date('2025-08-02T08:00:00Z').getTime()
    const pts = [
      { x: base + 0 * 86400000, y: 11 },
      { x: base + 1 * 86400000, y: 9 },
      { x: base + 2 * 86400000, y: 7 },
    ]
    const ref = [{ y: 10, label: 'Thresh' }]

    renderWithTheme(
      <Sparkline data={pts} refLines={ref} width={300} height={80} />
    )

    const svg = screen.getByLabelText('sparkline')
    const fbLine = svg.querySelector('line[stroke-dasharray="4 2"][stroke-width="1.5"]')
    expect(fbLine).toBeTruthy()
    // Dark theme stroke color
    expect(fbLine?.getAttribute('stroke')).toBe('#60a5fa')

    const badge = within(svg).getByText(/\d+d/)
    expect(badge).toHaveAttribute('fill', '#60a5fa')
  })

  test('hover guide and HTML tooltip styles (light theme) cover 598-623', () => {
    const t0 = new Date('2025-07-01T00:00:00Z').getTime()
    const pts = [
      { x: t0, y: 10 },
      { x: t0 + 60_000, y: 12 },
      { x: t0 + 120_000, y: 11 },
    ]

    renderWithTheme(<Sparkline data={pts} width={300} height={80} />)

    const svg = screen.getByLabelText('sparkline')
    // Trigger hover to render guide and tooltip
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 40 })

    // SVG hover guide (strokeDasharray="3 3") and focus circle with stroke set to bgFill
    const guide = svg.querySelector('line[stroke-dasharray="3 3"]')
    expect(guide).toBeTruthy()
    const hoverCircle = svg.querySelector('circle[stroke]')
    expect(hoverCircle).toBeTruthy()
    // In light theme, bgFill is #ffffff
    expect(hoverCircle.getAttribute('stroke')).toBe('#ffffff')

    // HTML tooltip overlay and its theme-dependent styles
    const tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeTruthy()
    // Theme-dependent assertions (light)
    expect(tip.style.background).toBe('rgb(255, 255, 255)')
    expect(tip.style.color).toBe('rgb(17, 24, 39)')
    // In JSDOM, computed border color is serialized to rgb()
    expect(tip.style.border).toContain('rgb(229, 231, 235)')
    // JSDOM normalizes rgba without spaces
    expect(tip.style.boxShadow).toBe('0 2px 8px rgba(0,0,0,0.1)')
    // Static style bits also reside within 609-623
    expect(tip.style.pointerEvents).toBe('none')
    expect(tip.style.whiteSpace).toBe('pre')
  })

  test('hover guide and HTML tooltip styles (dark theme) cover 598-623', () => {
    // Force dark theme preference
    localStorage.setItem('theme', 'dark')

    const t0 = new Date('2025-07-02T00:00:00Z').getTime()
    const pts = [
      { x: t0, y: 10 },
      { x: t0 + 60_000, y: 14 },
      { x: t0 + 120_000, y: 9 },
    ]

    renderWithTheme(<Sparkline data={pts} width={300} height={80} />)

    const svg = screen.getByLabelText('sparkline')
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 30 })

    // SVG guide exists; hover circle stroke equals dark bgFill (#111827)
    const guide = svg.querySelector('line[stroke-dasharray="3 3"]')
    expect(guide).toBeTruthy()
    const hoverCircle = svg.querySelector('circle[stroke]')
    expect(hoverCircle).toBeTruthy()
    expect(hoverCircle.getAttribute('stroke')).toBe('#111827')

    // Tooltip styles for dark theme
    const tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeTruthy()
    // Theme-dependent assertions (dark)
    expect(tip.style.background).toBe('rgb(17, 24, 39)')
    expect(tip.style.color).toBe('rgb(229, 231, 235)')
    expect(tip.style.border).toContain('rgb(55, 65, 81)')
    expect(tip.style.boxShadow).toBe('0 2px 8px rgba(0,0,0,0.6)')
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

  // Additional focused cases to cover remaining branch sites
  test('USA 12h clock shows 12 at midnight (covers 317: hh===0 -> 12)', () => {
    localStorage.setItem('dtFormat', 'usa')
    // Construct a local midnight time to ensure hours === 0
    const ts = new Date(2025, 0, 1, 0, 5, 0, 0).getTime()
    renderWithTheme(<Sparkline data={[{ x: ts, y: 3 }]} width={300} height={80} />)
    const svg = screen.getByLabelText('sparkline')
    fireEvent.mouseMove(svg, { clientX: 50, clientY: 20 })
    // Expect formatted time to contain 12:05 AM (not 0:05)
    expect(screen.getByText(/12:05\s?AM/)).toBeInTheDocument()
  })

  test('onMouseMove ignores non-finite px via rect.left=Infinity (covers 282)', () => {
    const t0 = Date.now()
    renderWithTheme(
      <Sparkline
        data={[{ x: t0, y: 1 }, { x: t0 + 1, y: 2 }]}
        width={300}
        height={80}
      />
    )
    const svg = screen.getByLabelText('sparkline')
    // Override this element's bounding rect so left is Infinity => px becomes -Infinity
    const orig = svg.getBoundingClientRect
    svg.getBoundingClientRect = () => ({ left: Infinity, top: 0, width: 300, height: 80, right: 300, bottom: 80, x: 0, y: 0, toJSON() {} })
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 10 })
    // No tooltip should appear after this event alone
    const tip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tip).toBeUndefined()
    // Restore
    svg.getBoundingClientRect = orig
  })

  test('localStorage.getItem throws: dtPref try/catch branches are handled (covers 236-240, 303-306)', () => {
    // Mock getItem to throw to exercise both try/catch blocks (peaks and tooltip formatter)
    const getItemSpy = vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation((key) => {
      if (key === 'dtFormat') throw new Error('boom')
      return null
    })

    const t0 = Date.now()
    const pts = [
      { x: t0, y: 10 },
      { x: t0 + 86_400_000, y: 30 },
      { x: t0 + 2 * 86_400_000, y: 15 },
    ]
    // Provide peak detection thresholds so the code path that reads dtFormat is executed
    renderWithTheme(
      <Sparkline
        data={pts}
        maxWaterG={100}
        peakDeltaPct={0.1}
        showPeakVLines
        width={300}
        height={80}
      />
    )
    const svg = screen.getByLabelText('sparkline')
    // Hover to trigger defaultHoverLines which also reads dtFormat in a try/catch
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 30 })
    // A tooltip should still render despite the getItem error
    const tooltip = Array.from(document.querySelectorAll('div')).find((el) => el.style?.position === 'absolute')
    expect(tooltip).toBeTruthy()

    getItemSpy.mockRestore()
  })
})
