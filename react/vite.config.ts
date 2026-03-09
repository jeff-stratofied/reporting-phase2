import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/reporting-phase2/react/',
  build: {
    outDir: 'dist',
  },
})
