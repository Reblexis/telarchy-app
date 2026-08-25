import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Everything that runs this suite shares Viktor's 12-core laptop with
    // his desktop session; vitest's default of one thread per core has
    // contributed to freezing the machine. Two is plenty for this suite.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
