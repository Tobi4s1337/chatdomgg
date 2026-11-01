import { expect, it, vi } from 'vitest';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { mountSoulClockRoute } from './clock';

it('serves an uncached public realm timestamp', () => {
  let handler: ((response: unknown) => void) | undefined;
  const app = { get: vi.fn((path: string, fn: (response: unknown) => void) => { expect(path).toBe('/api/realm/clock'); handler = fn; }) };
  mountSoulClockRoute(app as unknown as uWebSocketsTransport['app'], () => 123456789);
  const headers = new Map<string, string>(); let body = '', status = '';
  const response = { cork(fn: () => void) { fn(); }, writeStatus(value: string) { status = value; return this; },
    writeHeader(key: string, value: string) { headers.set(key, value); return this; }, end(value: string) { body = value; return this; } };
  handler!(response);
  expect(status).toBe('200 OK');
  expect(headers.get('Cache-Control')).toBe('no-store');
  expect(JSON.parse(body)).toEqual({ version: 1, serverTime: 123456789 });
});
