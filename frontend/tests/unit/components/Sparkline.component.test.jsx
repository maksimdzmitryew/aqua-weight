import React from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from '../../../src/ThemeContext.jsx'
import Sparkline from '../../../src/components/Sparkline.jsx'

// Mock ResizeObserver to exercise effect and cleanup
const disconnectSpy = vi.fn()
class RO {
  constructor(cb) {
    this.cb = cb
  }
  observe() {
    // Trigger a resize measurement once
    this.cb?.([{ contentRect: { width: 320, height: 80 } }])
  }
  unobserve() {}
  disconnect() { disconnectSpy() }
}

describe('components/Sparkline (component-level behaviors)', () => {
  beforeAll(() => {
    // @ts-ignore
    global.ResizeObserver = RO
  })

  test('empty dataset renders without crashing and cleanup disconnects observer', () => {
    const { unmount } = render(
      <ThemeProvider>
        <Sparkline data={[]} width={240} height={80} />
      </ThemeProvider>
    )
    // Unmount triggers ResizeObserver disconnect branch
    unmount()
    expect(disconnectSpy).toHaveBeenCalled()
  })
})
