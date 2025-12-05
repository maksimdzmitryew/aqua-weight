import { defineConfig } from 'vitest/config'
// Use the same React plugin as Vite config to avoid missing dependency issues
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./setupTests.ts'],
    dir: './tests/unit',
    include: ['**/*.{test,spec}.{js,jsx,ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: [
        'src/**/*.stories.{js,jsx,ts,tsx}',
        'src/main.{js,ts,tsx}',
        'src/**/__tests__/**',
      ],
      lines: 100,
      statements: 100,
      functions: 100,
      branches: 100,
    },
  },
})
