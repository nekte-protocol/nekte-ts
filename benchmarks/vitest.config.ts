import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './benchmarks',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
