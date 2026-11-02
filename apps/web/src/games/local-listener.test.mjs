import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listenLocalRealm } from './local-listener.mjs';

// The installed upstream adapter discards hostname and announces readiness even on false.
// Keep that hostile contract here: the operator must supply the host and reject false itself.
function fixture(socket) {
  const calls = [];
  const app = { listen(...args) { calls.push(args.slice(0, -1)); args.at(-1)(socket); return this; } };
  const native = app.listen;
  const transport = { app, socket: null };
  const server = { async listen(port) {
    app.listen(port, value => { transport.socket = value; });
  } };
  return { server, transport, native, calls };
}

test('binds exactly the probed loopback address and preserves native callback ownership', async () => {
  const socket = {}, f = fixture(socket);
  await listenLocalRealm(f.server, f.transport, 5171, '127.0.0.10');
  assert.deepEqual(f.calls, [['127.0.0.10', 5171]]);
  assert.equal(f.transport.socket, socket);
  assert.equal(f.transport.app.listen, f.native);
});

test('rejects failed native binding even when the upstream server announces readiness', async () => {
  const f = fixture(false);
  await assert.rejects(listenLocalRealm(f.server, f.transport, 5171, '127.0.0.1'), /could not bind/);
  assert.equal(f.transport.socket, false);
  assert.equal(f.transport.app.listen, f.native);
});

test('refuses remote addresses and reserved ports before touching a listener', async () => {
  for (const [port, host] of [[5171, '0.0.0.0'], [5171, '127.0.0.11'], [5187, '127.0.0.1'], [5190, '127.0.0.10'], [5197, '127.0.0.1']]) {
    const f = fixture({});
    await assert.rejects(listenLocalRealm(f.server, f.transport, port, host));
    assert.deepEqual(f.calls, []);
    assert.equal(f.transport.app.listen, f.native);
  }
});

test('restores the app method if setup throws', async () => {
  const f = fixture({});
  f.server.listen = async () => { throw new Error('setup failed'); };
  await assert.rejects(listenLocalRealm(f.server, f.transport, 5171, '127.0.0.10'), /setup failed/);
  assert.equal(f.transport.app.listen, f.native);
});
