import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward /test/* and /prod/* to local Envoy gRPC-Web proxy
      '/test': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/prod': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
