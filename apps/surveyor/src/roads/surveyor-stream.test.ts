import { describe, expect, it, vi } from 'vitest';
import { AtlasRaidSchema, type AtlasRaid } from '@chatdom/shared';
import { streamSurveyorRaids, surveyorBaseUrl } from './surveyor-stream';

const base = surveyorBaseUrl('https://collector.test/atlas/api');
const raw = { from: { id: '11', login: 'private_from', name: 'Félice' }, to: { id: '22', login: 'private_to', name: 'Other' }, viewers: 5, at: 1234 };
const encode = (value: string) => new TextEncoder().encode(value);
const event = (value: unknown = raw) => `event: raid\ndata: ${JSON.stringify(value)}\n\n`;
const finite = (...chunks: Uint8Array[]): typeof fetch => async () => new Response(new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(x)); c.close(); } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
const run = (fetcher: typeof fetch, onRaid: (raid: AtlasRaid) => void = () => {}) => streamSurveyorRaids(base, { signal: new AbortController().signal, fetch: fetcher, onRaid, idleMs: 200 });

describe('surveyor live raid stream', () => {
  it('requires an explicit safe HTTP base', () => {
    expect(base.href).toBe('https://collector.test/atlas/api/');
    for (const url of ['ftp://host/', 'https://user:pass@host/', 'https://host/?x=1', 'https://host/#x', '/relative']) expect(() => surveyorBaseUrl(url)).toThrow();
  });

  it('decodes chunked UTF-8, CRLF and multiline data, ignores non-raid events and never requests a cursor', async () => {
    const received: AtlasRaid[] = []; let request: { url: string; init: RequestInit | undefined } | undefined;
    const text = `retry: 5000\r\n: heartbeat\r\nid: collector-secret\r\nevent: other\r\ndata: {}\r\n\r\nevent: raid\r\ndata: ${JSON.stringify(raw).replace(',"to":', ',\r\ndata: "to":')}\r\n\r\n${event()}`;
    const bytes = encode(text); const accent = bytes.indexOf(0xc3);
    const fetcher: typeof fetch = async (input, init) => { request = { url: String(input), init }; return finite(bytes.slice(0, accent + 1), bytes.slice(accent + 1, accent + 2), bytes.slice(accent + 2))(input, init); };
    await expect(run(fetcher, raid => received.push(raid))).rejects.toMatchObject({ code: 'closed' });
    expect(request?.url).toBe('https://collector.test/atlas/api/raids');
    expect(new Headers(request?.init?.headers).has('last-event-id')).toBe(false);
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(received[1]);
    expect(AtlasRaidSchema.parse(received[0])).toMatchObject({ fromKingdomId: '11', toKingdomId: '22', viewers: 5, observedAt: 1234, occurredAt: null, delivery: 'ephemeral', source: 'surveyor-sse', evidence: { kind: 'observed', asOf: 1234 } });
    expect(JSON.stringify(received)).not.toMatch(/private_from|private_to|Félice|Other/);
  });

  it('reports EOF as a gap and never dispatches an unterminated event', async () => {
    const onRaid = vi.fn();
    await expect(run(finite(encode(event() + event().slice(0, -1))), onRaid)).rejects.toMatchObject({ code: 'closed' });
    expect(onRaid).toHaveBeenCalledOnce();
  });

  it.each([['bad JSON', 'event: raid\ndata: {\n\n'], ['too few viewers', event({ ...raw, viewers: 4 })], ['invalid UTF-8', null]])('rejects %s without dispatch', async (_label, body) => {
    const onRaid = vi.fn(); const bytes = body === null ? new Uint8Array([0xff]) : encode(body);
    await expect(run(finite(bytes), onRaid)).rejects.toMatchObject({ code: 'invalid' });
    expect(onRaid).not.toHaveBeenCalled();
  });

  it.each([['line', encode('x'.repeat(32769))], ['frame', encode(`data: ${'a'.repeat(16384)}\ndata: ${'b'.repeat(16384)}\n\n`)], ['chunk', new Uint8Array(262145)]])('bounds %s bytes', async (_label, bytes) => {
    await expect(run(finite(bytes))).rejects.toMatchObject({ code: 'too-large' });
  });

  it('classifies HTTP and content type failures', async () => {
    await expect(run(async () => new Response('bad', { status: 503 }))).rejects.toMatchObject({ code: 'http' });
    await expect(run(async () => new Response('bad', { headers: { 'content-type': 'application/json' } }))).rejects.toMatchObject({ code: 'format' });
  });

  it('propagates a synchronous durable-write failure unchanged and stops dispatch', async () => {
    const failure = new Error('disk failure'); const onRaid = vi.fn(() => { throw failure; });
    await expect(run(finite(encode(event() + event())), onRaid)).rejects.toBe(failure);
    expect(onRaid).toHaveBeenCalledOnce();
  });

  it('cancels a pending read on caller abort and preserves the abort reason', async () => {
    const controller = new AbortController(); const reason = new Error('stop'); let cancelled = false; let opened!: () => void;
    const ready = new Promise<void>(resolve => { opened = resolve; });
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    const pending = streamSurveyorRaids(base, { signal: controller.signal, fetch: fetcher, onRaid: () => {}, onOpen: opened, idleMs: 1000 });
    await ready; controller.abort(reason);
    await expect(pending).rejects.toBe(reason); expect(cancelled).toBe(true);
  });

  it('comments refresh the idle deadline, then an idle connection reports a gap', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>; let opened!: () => void; let cancelled = false;
    const ready = new Promise<void>(resolve => { opened = resolve; });
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({ start(c) { source = c; }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    const pending = streamSurveyorRaids(base, { signal: new AbortController().signal, fetch: fetcher, onRaid: () => {}, onOpen: opened, idleMs: 150 });
    const outcome = pending.catch(error => error); await ready;
    await new Promise(resolve => setTimeout(resolve, 90)); source.enqueue(encode(': keepalive\n\n'));
    await new Promise(resolve => setTimeout(resolve, 90)); expect(cancelled).toBe(false);
    expect(await outcome).toMatchObject({ code: 'idle' }); expect(cancelled).toBe(true);
  });
});
