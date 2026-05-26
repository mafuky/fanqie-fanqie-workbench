import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'src/web',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4400',
        ws: true
      }
    }
  },
  build: {
    outDir: '../../dist/web'
  }
})
