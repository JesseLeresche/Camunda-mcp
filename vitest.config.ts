import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'client/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
