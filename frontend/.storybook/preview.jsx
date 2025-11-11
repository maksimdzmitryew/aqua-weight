import React from 'react'
import { ThemeProvider } from '../src/ThemeContext.jsx'

export const decorators = [
  (Story) => (
    <ThemeProvider>
      <div style={{ padding: 16 }}>
        <Story />
      </div>
    </ThemeProvider>
  ),
]
