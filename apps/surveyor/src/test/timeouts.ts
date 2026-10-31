import { vi } from 'vitest';

/**
 * For suites that run real imports. Each import draws the whole preview land (seeded noise over the full field)
 * and fsyncs every file it publishes: 0.5–2.5 s per test on an idle machine. On a shared host under load that
 * passes vitest's 5 s default, so these files get 30 s, which still fails a hung import or server.
 * Call once at the top of the test file.
 */
export function allowRealImports(): void {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
}
