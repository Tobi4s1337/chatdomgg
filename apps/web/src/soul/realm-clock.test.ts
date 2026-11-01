import { describe, expect, it } from 'vitest';
import { createRealmSoulClock } from './realm-clock';

describe('realm soul clock', () => {
  it('estimates the midpoint, advances through midnight and never moves back on resync', async () => {
    let mono = 100, epoch = Date.UTC(2026, 0, 1, 23, 59, 59);
    const fetcher = (async () => { mono += 200; return new Response(JSON.stringify({ version: 1, serverTime: epoch })); }) as typeof fetch;
    const clock = createRealmSoulClock({ now: () => mono, fetch: fetcher });
    expect(clock.now()).toBeNull();
    expect(await clock.sync()).toBe(true);
    expect(clock.now()).toBe(epoch + 100);
    mono += 1000;
    expect(clock.now()).toBe(epoch + 1100);
    epoch -= 10_000;
    expect(await clock.sync()).toBe(true);
    expect(clock.now()).toBe(Date.UTC(2026, 0, 2, 0, 0, 0, 300));
  });
  it('rejects bad or excessively delayed responses without installing a clock', async () => {
    let mono = 0;
    const clock = createRealmSoulClock({ now: () => mono, fetch: (async () => {
      mono = 10_001; return new Response(JSON.stringify({ version: 1, serverTime: Date.UTC(2026, 1) }));
    }) as typeof fetch });
    expect(await clock.sync()).toBe(false);
    expect(clock.now()).toBeNull();
  });
});
