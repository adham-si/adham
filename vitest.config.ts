import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/desktop/src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['{apps,packages}/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.opencode/**', '**/.playwright-mcp/**'],
  },
});
