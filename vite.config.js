import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.monkeycode-ai.live']
  },
  preview: {
    port: 4173,
    host: true,
    allowedHosts: ['.monkeycode-ai.live']
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
