import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Separar vendor en chunks propios: mejora cacheo (no cambian entre deploys)
        // y baja el peso del chunk de la app.
        // Vite 8 / rolldown requires manualChunks as a function (object form not supported).
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react';
          }
          if (id.includes('node_modules/framer-motion')) {
            return 'framer-motion';
          }
          if (id.includes('node_modules/@supabase')) {
            return 'supabase';
          }
        },
      },
    },
  },
  server: {
    host: true,        // escucha en 0.0.0.0 para ser accesible desde fuera del contenedor
    port: 5173,
    watch: {
      usePolling: true, // hot reload sobre bind-mount en Docker Desktop (Mac)
    },
  },
})
