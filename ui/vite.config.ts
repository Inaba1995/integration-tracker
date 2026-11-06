import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * В dev: UI на :5173, API проксируется на :4000.
 * В проде: dist отдаётся бэкендом (fastify/static).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/openapi.yaml': 'http://localhost:4000',
    },
  },
});
