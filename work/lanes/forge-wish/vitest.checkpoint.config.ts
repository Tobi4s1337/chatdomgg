import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['work/lanes/forge-wish/runtime/**/*.test.ts'],
  environment: 'node', maxWorkers: 1, fileParallelism: false, testTimeout: 30_000, reporters: ['dot'] } });
