import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Node server owns /api and /ws in every environment; Railway serves the
// built client from the same process, so no CORS or second service is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
