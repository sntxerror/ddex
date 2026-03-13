import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy gRPC-Web requests to MobileCoin testnet Fog gateway
      '/fog': {
        target: 'https://fog.test.mobilecoin.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/fog/, ''),
      },
      // Proxy consensus node requests
      '/consensus': {
        target: 'https://node1.test.mobilecoin.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/consensus/, ''),
      },
    },
  },
})
