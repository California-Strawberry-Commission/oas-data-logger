import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],  
  server: {
    proxy: {
      "/runs": {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      }
    }
  }
})
