/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The demo imports the real backend domain services (in-memory adapters): no mocks, no copies.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@core': fileURLToPath(new URL('../backend/src', import.meta.url)) },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.tsx'],
  },
});
