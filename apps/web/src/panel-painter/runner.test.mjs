import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { clockAtHour, runPainter } from './runner.mjs';

// Transport doubles exercise the private/public boundary and orchestration without rendering a fake kingdom.
function harness({ changedHash = false, sourceMissing = false, rejectUpload = false } = {}) {
  const bytes = Buffer.from('{}'), hash = createHash('sha256').update(bytes).digest('hex');
  const calls = [], pages = [], reports = [];
  let locked = false, closed = false;
  const config = { webOrigin: 'http://localhost:5170', apiOrigin: 'http://localhost:5171', realmOrigin: 'http://localhost:5172',
    kingdomIds: ['123', '456'], ingressSecret: 'r'.repeat(32), uploadSecret: 'p'.repeat(32) };
  const acquireLock = async () => { assert.equal(locked, false); locked = true; return () => { locked = false; }; };
  const launch = async () => {
    assert.equal(locked, true);
    return { newContext: async () => ({ newPage: async () => {
      assert.equal(locked, true);
      const page = { input: null, closed: false, on: () => {},
        route: async () => {}, exposeBinding: async (_name, read) => { page.input = await read(); },
        goto: async url => { assert.equal(url, `${config.webOrigin}/-/panel-painter`); assert.equal(locked, true); },
        waitForFunction: async () => {}, screenshot: async () => { assert.equal(locked, true); return Buffer.from('browser PNG'); },
        evaluate: async (fn, input) => input?.png ? { bytes: [82, 73, 70, 70], width: 636, height: 400 } : fn.toString().includes('.error()') ? null : fn.toString().includes('.windows()') ? [[3, 4120, 6330]] : undefined,
        close: async () => { page.closed = true; },
      }; pages.push(page); return page;
    }, close: async () => {} }), close: async () => { closed = true; } };
  };
  const fetcher = async (url, init = {}) => {
    calls.push({ url, ...init });
    if (url.endsWith('/api/realm/clock')) return globalThis.Response.json({ version: 1, serverTime: 120_000 });
    if (url.endsWith('/internal/realm/panel/kingdom')) {
      assert.equal(init.headers.Authorization, `Bearer ${config.ingressSecret}`);
      const { kingdomId } = JSON.parse(init.body);
      return globalThis.Response.json({ status: 'kingdom', kingdomId, stream: 'live', manifest: { kingdomId, origin: 'live', sceneHash: changedHash ? 'b'.repeat(64) : hash },
        presence: sourceMissing ? null : { kingdomId, origin: 'live', connection: 'fresh', windows: [] } });
    }
    if (url.includes('/internal/realm/panel/scene/')) return new globalThis.Response(bytes);
    if (url.endsWith('/api/panel/v1/stills')) {
      assert.equal(init.headers.Authorization, `Bearer ${config.uploadSecret}`);
      assert.equal(init.headers['Content-Type'], 'image/webp');
      assert.match(init.headers['X-Chatdom-Revision'], /^[a-f0-9]{64}$/);
      assert.equal(init.headers['X-Chatdom-Captured-At'], '120000');
      assert.equal(init.headers['X-Chatdom-Windows'], '3:4120:6330');
      return new globalThis.Response('', { status: rejectUpload ? 503 : 201 });
    }
    throw new Error('Unexpected transport');
  };
  return { config, options: { once: true, launch, acquireLock, fetcher, report: message => reports.push(message) }, calls, pages, reports,
    assertClosed() { assert.equal(closed, true); assert.equal(locked, false); } };
}

test('runner gives each kingdom its own page, keeps secrets in Node and authenticates raw uploads', async () => {
  const h = harness(); const result = await runPainter(h.config, h.options);
  assert.deepEqual(result, { painted: 2, unavailable: 0, unchanged: 0 });
  assert.equal(h.pages.length, 2);
  assert.equal(h.calls.filter(call => call.url.endsWith('/stills')).length, 2);
  assert.ok(h.reports.every(message => message.endsWith('1 lit window in frame.')));
  for (const page of h.pages) {
    assert.ok(page.input.sceneBytes);
    assert.equal(JSON.stringify(page.input).includes(h.config.ingressSecret), false);
    assert.equal(JSON.stringify(page.input).includes(h.config.uploadSecret), false);
  }
  h.assertClosed();
});

test('runner refuses changed scene bytes and missing public presence before a browser page opens', async () => {
  for (const options of [{ changedHash: true }, { sourceMissing: true }]) {
    const h = harness(options); await runPainter(h.config, h.options);
    assert.equal(h.pages.length, 0);
    assert.equal(h.calls.some(call => call.url.endsWith('/stills')), false);
    h.assertClosed();
  }
});

test('failed upload closes the affected warm page and reports no successful painting', async () => {
  const h = harness({ rejectUpload: true }); const result = await runPainter(h.config, h.options);
  assert.deepEqual(result, { painted: 0, unavailable: 2, unchanged: 0 });
  assert.ok(h.pages.every(page => page.closed));
  assert.equal(h.reports.some(message => message.includes('painted ')), false);
  assert.equal(h.reports.length, 2);
  h.assertClosed();
});

test('an evidence hour moves only the page clock forward to that hour and keeps the rest of the answer', async () => {
  const real = Date.UTC(2026, 10, 2, 10, 7, 5);
  const moved = JSON.parse(clockAtHour(Buffer.from(JSON.stringify({ version: 1, serverTime: real })), 22).toString());
  assert.equal(moved.version, 1);
  assert.equal(moved.serverTime, Date.UTC(2026, 10, 2, 22, 0, 0));
  const wrapped = JSON.parse(clockAtHour(Buffer.from(JSON.stringify({ version: 1, serverTime: real })), 6.5).toString());
  assert.equal(wrapped.serverTime, Date.UTC(2026, 10, 3, 6, 30, 0));
  await assert.rejects(runPainter({}, { hour: 24 }), /evidence hour/);
});
