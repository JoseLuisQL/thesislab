import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 3101),
    proxy: {
      '/health': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/status': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/theses': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/zotero': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/policy-profiles': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
});
