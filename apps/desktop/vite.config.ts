import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  clearScreen: false,
  server: {
    // Tauri's devUrl is pinned to 11111, so that is the port `tauri dev` needs.
    // Verification runs (Task 13) reuse it; `strictPort` makes a collision fail
    // loudly instead of silently drifting onto another port and leaving the
    // Tauri window blank.
    port: 11111,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
