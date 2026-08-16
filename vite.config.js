import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.monkeycode-ai.live'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  },
  preview: {
    port: 4173,
    host: true,
    allowedHosts: ['.monkeycode-ai.live']
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 600
  }
})
