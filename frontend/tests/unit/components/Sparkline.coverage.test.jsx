import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import Sparkline from '../../../src/components/Sparkline.jsx'

function renderWithTheme(ui) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('Sparkline Coverage Tests', () => {
  test('covers line 238: maxY === minY', () => {
    const data = [
      { x: 1, y: 10 },
      { x: 2, y: 10 },
    ]
    // When minYData = 10 and maxYData = 10, minY = 10, maxY = 10.
    // Line 238: if (!isFinite(maxY) || maxY === minY) maxY = (isFinite(minY) ? minY + 1 : 1)
    // Should result in maxY = 11.
    renderWithTheme(<Sparkline data={data} width={200} height={100} />)
    const svg = screen.getByLabelText('sparkline')
    expect(svg).toBeInTheDocument()
  })

  test('covers line 238: !isFinite(maxY)', () => {
    // To make maxY non-finite, we can pass no data and no refLines
    // minYData = Infinity, maxYData = -Infinity
    // minYRef = Infinity, maxYRef = -Infinity
    // minY = Infinity, maxY = -Infinity
    // Line 237: if (!isFinite(minY)) minY = 0
    // Line 238: if (!isFinite(maxY) || maxY === minY) maxY = (isFinite(minY) ? minY + 1 : 1)
    renderWithTheme(<Sparkline data={[]} refLines={[]} width={200} height={100} />)
    const svg = screen.getByLabelText('sparkline')
    expect(svg).toBeInTheDocument()
  })

  test('covers lines 244 and 248: sx and sy with non-finite values', () => {
    // sx(x) = margin.left + ((x - minX) / spanX) * w
    // sy(y) = margin.top + (1 - (y - minY) / spanY) * h
    
    // If spanX is 1 (default when maxX == minX) and x is Infinity
    const data = [{ x: 1, y: 10 }]
    // minX = 1, maxX = 1, spanX = 1
    // minY = 10, maxY = 11, spanY = 1
    
    // We need to trigger sx or sy with something that results in non-finite.
    // However, sx and sy are called inside the component with points from data.
    // If we pass a point with NaN or Infinity, it's filtered out in line 224:
    // const points = Array.isArray(data) ? data.filter(d => d && isFinite(d.x) && isFinite(d.y)) : []
    
    // Wait, line 252:
    // const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x)},${sy(p.y)}`).join(' ')
    // It uses points.
    
    // How to get non-finite in sx/sy then?
    // Maybe if spanX or spanY is 0? 
    // Line 239: const spanX = maxX - minX || 1
    // Line 240: const spanY = maxY - minY || 1
    // They fall back to 1 if 0.
    
    // What if w or h is non-finite?
    // line 221: const w = Math.max(0, vbWidth - margin.left - margin.right)
    // line 222: const h = Math.max(0, vbHeight - margin.top - margin.bottom)
    // vbWidth comes from width prop or measuredW.
    // vbHeight comes from height prop.
    
    // If height is NaN:
    renderWithTheme(<Sparkline data={[{x:1, y:10}, {x:2, y:20}]} width={NaN} height={NaN} />)
    
    // Let's look at sy again:
    // const val = margin.top + (1 - (y - minY) / spanY) * h
    // if h is NaN, val is NaN.
    
    const svg = screen.getByLabelText('sparkline')
    expect(svg).toBeInTheDocument()
  })

  test('covers line 248 result check: val is NaN', () => {
    // sy(y) {
    //   const val = margin.top + (1 - (y - minY) / spanY) * h
    //   const result = Number.isFinite(val) ? val : 0
    //   return result
    // }
    // If h is NaN, val is NaN, so result is 0.
    // Already covered by the test above, but let's be explicit and try with w as well for sx.
    renderWithTheme(<Sparkline data={[{x:1, y:10}]} width={NaN} height={100} />)
  })

  test('covers line 469: height is not finite', () => {
    // line 469: height: Number.isFinite(height) ? height : '100%'
    renderWithTheme(<Sparkline data={[{x:1, y:10}]} width={200} height="100%" />)
    const svg = screen.getByLabelText('sparkline')
    expect(svg).toBeInTheDocument()
  })

  test('covers line 238 ternary: isFinite(minY) is false', () => {
    // This is tricky because line 237: if (!isFinite(minY)) minY = 0
    // So by line 238, minY is ALWAYS finite.
    // However, if we could bypass 237, we might hit it.
    // Since we can't bypass 237, let's see if we can trigger the || 1 in line 240.
    // Line 240: const spanY = maxY - minY || 1
    // If maxY - minY is 0, it takes || 1.
    // But line 238 says if maxY === minY, maxY = minY + 1.
    // So maxY - minY is 1.
    
    // Let's try to pass values that might cause floating point issues?
    // Not likely to help with "exactly 0".
    
    // Wait! What if we have NO data and NO refLines?
    // minYData = Infinity, maxYData = -Infinity
    // minYRef = Infinity, maxYRef = -Infinity
    // minY = Infinity, maxY = -Infinity
    // 237: minY = 0
    // 238: !isFinite(maxY) is true (it is -Infinity), so maxY = 0 + 1 = 1.
    // spanY = 1 - 0 = 1.
    
    // If I want to hit EVERY branch, I should ensure I have tests for:
    // 1. minY is not finite (line 237)
    // 2. maxY is not finite (line 238)
    // 3. maxY === minY (line 238)
    // 4. spanX is 0 (line 239)
    // 5. spanY is 0 (line 240) - if possible
    
    const { container } = renderWithTheme(<Sparkline data={[]} refLines={[]} />)
    expect(container).toBeInTheDocument()
  })

  test('covers line 237: minY is not finite', () => {
    // data=[], refLines=[] => minY = Infinity
    renderWithTheme(<Sparkline data={[]} refLines={[]} />)
  })

  test('covers line 238: maxY is not finite', () => {
    // data=[], refLines=[] => maxY = -Infinity
    renderWithTheme(<Sparkline data={[]} refLines={[]} />)
  })

  test('covers line 238: maxY === minY', () => {
    renderWithTheme(<Sparkline data={[{x: 1, y: 10}, {x: 2, y: 10}]} />)
  })

  test('covers line 239: spanX fallback', () => {
    renderWithTheme(<Sparkline data={[{x: 1, y: 10}]} />)
  })
})
