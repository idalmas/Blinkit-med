import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3003',
        ws: true,
      },
      '/zoom': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
    },
  },
})
