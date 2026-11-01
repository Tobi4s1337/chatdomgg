import { Buffer } from 'node:buffer';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { helperSource } from './helper.mjs';

test('Helper signs identities and refreshes authorization on sharing', async () => {
  const secret = randomBytes(32).toString('base64');
  const window = {};
  runInNewContext(helperSource(secret, { channel: '22', user: '33' }), { window, queueMicrotask: globalThis.queueMicrotask });
  const auths = [];
  window.Twitch.ext.onAuthorized(auth => auths.push(auth));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(auths.length, 1);
  const verify = token => {
    const [header, payload, signature] = token.split('.');
    assert.equal(signature, createHmac('sha256', Buffer.from(secret, 'base64')).update(`${header}.${payload}`).digest('base64url'));
    return JSON.parse(Buffer.from(payload, 'base64url'));
  };
  assert.equal(verify(auths[0].token).channel_id, '22');
  assert.equal(verify(auths[0].token).user_id, undefined);
  window.Twitch.ext.actions.requestIdShare();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.__panelHarness.shareRequests, 1);
  assert.equal(window.Twitch.ext.viewer.isLinked, true);
  assert.equal(verify(auths[1].token).user_id, '33');
  assert.notEqual(auths[0].token, auths[1].token);
  window.__panelHarness.setIdentity('logged-out');
  assert.ok(auths.at(-1).userId.startsWith('A'));
  assert.equal(verify(auths.at(-1).token).user_id, undefined);
});

test('Helper drives context, visibility and subscribed PubSub listeners', async () => {
  const window = {};
  runInNewContext(helperSource(randomBytes(32).toString('base64')), { window, queueMicrotask: globalThis.queueMicrotask });
  const contexts = [], visible = [], messages = [];
  window.Twitch.ext.onContext(context => contexts.push(context));
  window.Twitch.ext.onVisibilityChanged(value => visible.push(value));
  window.Twitch.ext.listen('broadcast', (...args) => messages.push(args));
  await new Promise(resolve => setImmediate(resolve));
  window.__panelHarness.setPlaying(false);
  window.__panelHarness.setVisible(false);
  window.__panelHarness.publish('other', 'ignored');
  window.__panelHarness.publish('broadcast', 'hello');
  assert.equal(contexts.at(-1).isPaused, true);
  assert.equal(visible.at(-1), false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0][2], 'hello');
});
