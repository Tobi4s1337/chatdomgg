import { defineConfig } from 'vitest/config';
// This host also runs production services: avoid one worker per visible host CPU.
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'], environment: 'node', maxWorkers: 2 } });
