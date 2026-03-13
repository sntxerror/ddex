import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward /fog and /consensus to local Envoy gRPC-Web proxy
      '/fog': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/consensus': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
