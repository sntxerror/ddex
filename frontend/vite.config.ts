import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
// https://vite.dev/config/
export default defineConfig({
  envDir: '..',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg'],
      manifest: {
        name: 'DDEX Vault',
        short_name: 'DDEX',
        description: 'Private MobileCoin wallet shell for DDEX.',
        theme_color: '#0a0e1a',
        background_color: '#0a0e1a',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 30,
                maxEntries: 8,
              },
            },
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
          },
          {
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 365,
                maxEntries: 16,
              },
            },
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
          },
        ],
        skipWaiting: true,
      },
      devOptions: {
        disableRuntimeConfig: true,
        enabled: false,
        suppressWarnings: true,
        type: 'module',
      },
    }),
  ],
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
