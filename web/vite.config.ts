import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :8080 (npm run dev in ../api).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8080' } },
  build: { chunkSizeWarningLimit: 1500 },
});
