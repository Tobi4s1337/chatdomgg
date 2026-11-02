import assert from 'node:assert/strict';

/** Harness-only binding for the installed transport, whose listen implementation drops hostname.
 * Preserve its callback and native-socket ownership, but call uWS's explicit host overload.
 * Restore the app method immediately after setup; production transport code is untouched.
 * https://github.com/uNetworking/uWebSockets.js/blob/master/docs/index.d.ts
 */
export async function listenLocalRealm(server, transport, port, host) {
  assert.ok(['127.0.0.1', '127.0.0.10'].includes(host), 'Only explicit local gather hosts are allowed');
  assert.ok(Number.isInteger(port) && port >= 5170 && port <= 5189 && port !== 5187, 'Choose an approved capture port');
  const app = transport.app, nativeListen = app.listen;
  let bound = false;
  app.listen = function (requestedPort, callback) {
    assert.equal(requestedPort, port, 'The transport must bind its probed port');
    assert.equal(typeof callback, 'function', 'The installed transport listener signature changed');
    return nativeListen.call(app, host, port, socket => { bound = !!socket; callback(socket); });
  };
  try {
    await server.listen(port, host);
    if (!bound) throw new Error(`The local realm could not bind ${host}:${port}; no other service was touched.`);
  } finally { app.listen = nativeListen; }
}
