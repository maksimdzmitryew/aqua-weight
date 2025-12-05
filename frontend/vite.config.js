// JS wrapper to ensure Vite dev server in test stack loads the SWC React plugin
// Some environments load vite.config.js preferentially; keep this in sync with vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    entries: ['index.html'],
    exclude: [
      '@storybook/*',
      '@storybook/builder-vite',
      'storybook',
      'virtual:/@storybook/builder-vite/vite-app.js',
    ],
  },
  server: {
    // Allow proxying through nginx with Host aw.max and listening on all interfaces
    host: true,
    allowedHosts: ['aw.max'],
    fs: {
      strict: true,
    },
  },
})
