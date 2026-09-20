import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 9118,
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': 'http://localhost:9117',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
