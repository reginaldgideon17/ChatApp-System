import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const exposedEnv = {
  REACT_APP_TURN_URL: process.env.REACT_APP_TURN_URL || '',
  REACT_APP_TURN_USERNAME: process.env.REACT_APP_TURN_USERNAME || '',
  REACT_APP_TURN_CREDENTIAL: process.env.REACT_APP_TURN_CREDENTIAL || '',
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'web-vitals': fileURLToPath(new URL('./src/vitals-shim.js', import.meta.url)),
    },
  },
  define: {
    'process.env': JSON.stringify(exposedEnv),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
