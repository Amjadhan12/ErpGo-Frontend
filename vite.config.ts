import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    // Enables the "@/..." alias declared in tsconfig.app.json.
    tsconfigPaths: true,
  },
  server: {
    port: 5173,
  },
})
