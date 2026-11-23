import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      // O manifesto fica em public/manifest.webmanifest e só é ligado nas telas da equipe
      // (o cliente que abre o cardápio pelo QR não recebe convite para instalar o app).
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webp}'],
        // Pisos e mesas do mapa só são usados pela equipe: o cliente do cardápio não baixa.
        globIgnores: ['**/*-{vietnamese,cyrillic,cyrillic-ext,greek,greek-ext}-*.woff2', '**/img/pisos/**', '**/img/mesas/**'],
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(@firebase\/(app|app-check|auth|firestore|util|component|logger|webchannel-wrapper)|firebase\/(app|app-check|auth|firestore))\//.test(id))
            return 'firebase'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
        },
      },
    },
  },
})
