import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,        // escucha en 0.0.0.0 para ser accesible desde fuera del contenedor
    port: 5173,
    watch: {
      usePolling: true, // hot reload sobre bind-mount en Docker Desktop (Mac)
    },
  },
})
