import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'icons/*.png'],
    manifest: {
      name: 'Production Digital', short_name: 'Production',
      description: 'Production checksheets and Henkaten for ABB2',
      theme_color: '#131d2a', background_color: '#10161f',
      display: 'fullscreen', display_override: ['fullscreen', 'standalone'], id: '/', start_url: '/#checksheet', scope: '/',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      clientsClaim: true,
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      navigateFallbackDenylist: [/^\/api\//],
      // Only the app shell is cached. Production records and credentials stay network-only.
      runtimeCaching: [{ urlPattern: /\/api\//, handler: 'NetworkOnly' }]
    }
  })],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3700' } }
});
