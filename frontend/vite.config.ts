import { defineConfig } from 'vite'
// Use SWC-based React plugin to avoid Babel runtime issues in the test container
import react from '@vitejs/plugin-react-swc'

// Vite dev server config for the runtime app (not Storybook).
// We explicitly scope dependency optimization to our app entry and
// exclude Storybook builder virtual modules that may be present in node_modules
// so they don't trigger resolution errors during startup.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Only scan the app entry. This prevents Vite from crawling unrelated HTML
    // files (like Storybook's iframe.html) in node_modules.
    entries: ['index.html'],
    // Ensure Storybook packages/virtual modules are not considered during optimize scan
    exclude: [
      '@storybook/*',
      '@storybook/builder-vite',
      'storybook',
      'virtual:/@storybook/builder-vite/vite-app.js',
    ],
  },
  server: {
    fs: {
      // Restrict file serving to the project root by default
      strict: true,
    },
  },
})
