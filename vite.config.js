import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves from the domain root (CNAME), so base '/' is correct.
  base: '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // Registrierung erfolgt manuell in main.js via virtual:pwa-register
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,json,ico}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 }
            }
          }
        ]
      },
      manifest: false // bestehende public/manifest.json wird weiterverwendet
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
