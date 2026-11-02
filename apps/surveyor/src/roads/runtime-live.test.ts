import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FixtureSource, sweepAt } from '../test/fixture-source';
import { createRoadRuntime } from './runtime';
import { RoadLedger } from './ledger';

const dirs: string[] = [];
const sources: FixtureSource[] = [];
afterEach(() => { for (const source of sources.splice(0)) source.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const chunk = (at: number, from = '100', to = '200') => new TextEncoder().encode(`event: raid\ndata: ${JSON.stringify({ from: { id: from, login: null, name: null }, to: { id: to, login: null, name: null }, viewers: 8, at })}\n\n`);

it('recovers a missed older recorder row on reconnect without announcing it, then announces fresh durable SSE once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roads-live-')); dirs.push(dir);
  const source = FixtureSource.standard(); sources.push(source);
  const now = sweepAt(10); const live = vi.fn(); const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let cancellations = 0;
  const fetcher: typeof fetch = async input => {
    expect(String(input)).toBe('https://collector.test/raids');
    return new Response(new ReadableStream({ start(c) { streams.push(c); }, cancel() { cancellations++; } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  const runtime = createRoadRuntime(dir, { feedUrl: null, surveyorBase: 'https://collector.test/', recorderPath: source.path, now: () => now, pollMs: 10, recorderPollMs: 10000, reconnectMs: 100, streamIdleMs: 2000, fetch: fetcher, onLiveRaid: live });
  try {
    await vi.waitFor(() => expect(runtime.coverage().state).toBe('connected'), { timeout: 3000, interval: 10 });
    expect(runtime.coverage().recorder).toMatchObject({ cutAt: now, events: 3 });
    streams[0]!.close();
    await vi.waitFor(() => expect(runtime.coverage().state).toBe('gap'), { timeout: 1000, interval: 5 });
    source.addRaidObservation(sweepAt(1), '100', '200', 8, true);
    await vi.waitFor(() => { expect(streams).toHaveLength(2); expect(runtime.coverage().state).toBe('connected'); }, { timeout: 3000, interval: 10 });
    expect(runtime.ledger.road('100', '200')).toMatchObject({ observedRaids: 1 });
    expect(live).not.toHaveBeenCalled();
    streams[1]!.enqueue(chunk(now)); streams[1]!.enqueue(chunk(now));
    await vi.waitFor(() => expect(live).toHaveBeenCalledTimes(1), { timeout: 1000, interval: 10 });
    expect(runtime.ledger.road('100', '200')).toMatchObject({ observedRaids: 2 });
    expect(live.mock.calls[0]![0]).toMatchObject({ observedAt: now, source: 'surveyor-sse' });
  } finally { await runtime.close(); }
  expect(cancellations).toBeGreaterThanOrEqual(1);
  const reopened = new RoadLedger(dir);
  try { expect(reopened.road('100', '200')).toMatchObject({ observedRaids: 2 }); } finally { reopened.close(); }
});

it('never announces stale or future observations and releases an in-flight stream on close', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roads-live-')); dirs.push(dir);
  const source = FixtureSource.standard(); sources.push(source);
  const now = sweepAt(10); const live = vi.fn(); let controller!: ReadableStreamDefaultController<Uint8Array>; let cancelled = false;
  const fetcher: typeof fetch = async () => new Response(new ReadableStream({ start(c) { controller = c; }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  const runtime = createRoadRuntime(dir, { feedUrl: null, surveyorBase: 'https://collector.test/', recorderPath: source.path, now: () => now, pollMs: 10, reconnectMs: 1000, streamIdleMs: 2000, fetch: fetcher, onLiveRaid: live });
  try {
    await vi.waitFor(() => expect(runtime.coverage().state).toBe('connected'), { timeout: 3000, interval: 10 });
    controller.enqueue(chunk(now - 30001));
    await vi.waitFor(() => expect(runtime.ledger.road('100', '200')).toMatchObject({ observedRaids: 1 }), { timeout: 1000, interval: 10 });
    expect(live).not.toHaveBeenCalled();
    controller.enqueue(chunk(now + 5001));
    await vi.waitFor(() => expect(runtime.coverage().state).toBe('gap'), { timeout: 1000, interval: 10 });
    expect(live).not.toHaveBeenCalled(); expect(cancelled).toBe(true);
  } finally { await runtime.close(); }
  expect(runtime.coverage().state).toBe('stopped');
  const reopened = new RoadLedger(dir); reopened.close();
});
