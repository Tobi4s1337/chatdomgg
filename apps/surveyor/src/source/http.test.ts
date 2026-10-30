import { describe, expect, it } from 'vitest';
import { MAX_ERROR_DETAILS, MAX_ERROR_MESSAGE, type AtlasError } from '../errors';
import { FixtureSource, RECENT, fakeSurveyor } from '../test/fixture-source';
import { readSurveyorHttp } from './http';

const base = new URL('http://surveyor.test/atlas/api/');
const noSleep = async () => {};

describe('Surveyor HTTP reads', () => {
  it('validates status and recent pairs with the shared schemas', async () => {
    const source = FixtureSource.standard();
    const { fetchImpl, calls } = fakeSurveyor({ status: source.status(), 'raids/recent': RECENT });
    const read = await readSurveyorHttp(base, { timeoutMs: 200, fetchImpl, now: () => 42 });
    expect(read.status.sweeps).toBe(5);
    expect(read.recentPairs).toEqual(RECENT);
    expect(read.readAt).toBe(42);
    expect(read.base).toBe('http://surveyor.test/atlas/api/');
    expect(calls).toEqual(['/atlas/api/status', '/atlas/api/raids/recent']);
    source.close();
  });

  it('rejects a status that does not match the frozen schema, with bounded detail', async () => {
    const hostile = { since: 'x'.repeat(100_000), extra: 1, ...Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i])) };
    const { fetchImpl } = fakeSurveyor({ status: hostile });
    const error = (await readSurveyorHttp(base, { timeoutMs: 200, fetchImpl, sleep: noSleep }).then(() => null, (e: unknown) => e)) as AtlasError;
    expect(error).toMatchObject({ code: 'source-schema' });
    expect(error.message.length).toBeLessThanOrEqual(MAX_ERROR_MESSAGE);
    expect(error.details.length).toBeLessThanOrEqual(MAX_ERROR_DETAILS);
    expect(error.details.join('')).not.toContain('xxxx');
  });

  it('retries a 5xx once, never retries a 4xx, and stops at the attempt limit', async () => {
    const failing = fakeSurveyor({ status: async () => new Response('busy', { status: 503 }) });
    await expect(readSurveyorHttp(base, { timeoutMs: 200, fetchImpl: failing.fetchImpl, sleep: noSleep })).rejects.toMatchObject({ code: 'source-http' });
    expect(failing.calls).toHaveLength(2);
    const missing = fakeSurveyor({});
    await expect(readSurveyorHttp(base, { timeoutMs: 200, fetchImpl: missing.fetchImpl, sleep: noSleep })).rejects.toThrow(/HTTP 404/);
    expect(missing.calls).toHaveLength(1);
  });

  it('times out a silent Surveyor within its bound', async () => {
    const silent = fakeSurveyor({
      status: (signal?: AbortSignal | null) => new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason as Error))),
    });
    const started = Date.now();
    await expect(readSurveyorHttp(base, { timeoutMs: 100, fetchImpl: silent.fetchImpl, sleep: noSleep })).rejects.toThrow(/timed out after 100 ms/);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(silent.calls).toHaveLength(2);
  });

  it('refuses an oversized response', async () => {
    const huge = fakeSurveyor({ status: async () => new Response('x'.repeat(2_000), { status: 200 }) });
    await expect(readSurveyorHttp(base, { timeoutMs: 200, fetchImpl: huge.fetchImpl, maxBytes: 1_000, attempts: 1 })).rejects.toThrow(/byte limit/);
  });
});
