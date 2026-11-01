import { Buffer } from 'node:buffer';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const HELPER_URL = 'https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js';
export function laneSecret(path) {
  try { return readFileSync(path, 'utf8').trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const secret = randomBytes(32).toString('base64');
    try { writeFileSync(path, secret, { mode: 0o600, flag: 'wx' }); return secret; }
    catch (race) { if (race.code === 'EEXIST') return readFileSync(path, 'utf8').trim(); throw race; }
  }
}
export function sign(secret, claims) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${input}.${createHmac('sha256', Buffer.from(secret, 'base64')).update(input).digest('base64url')}`;
}
export function helperSource(secret, options = {}) {
  const { channel = '1234', user = '5678', client = 'panel-lane', identity = 'unshared', visible = true, playing = true, bits = false } = options;
  if (!['logged-out', 'unshared', 'shared'].includes(identity)) throw new Error('Unknown identity');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const auth = {};
  for (const state of ['logged-out', 'unshared', 'shared']) {
    const opaque = state === 'logged-out' ? 'Alaneviewer' : 'Ulaneviewer';
    const claims = { channel_id: channel, opaque_user_id: opaque, role: 'viewer', exp: expires, pubsub_perms: { listen: ['broadcast'], send: [] }, ...(state === 'shared' ? { user_id: user } : {}) };
    auth[state] = { channelId: channel, clientId: client, userId: opaque, token: sign(secret, claims), helixToken: '' };
  }
  // The signed tokens are held in this closure only; none enter a URL, DOM, storage, or log.
  return `(() => {
    const auth = ${JSON.stringify(auth)};
    let state = ${JSON.stringify(identity)}, visible = ${JSON.stringify(visible)}, playing = ${JSON.stringify(playing)};
    const authorized = [], viewers = [], contexts = [], visibility = [], features = [], listeners = [], complete = [], cancelled = [];
    let shareRequests = 0;
    const notifyAuth = () => { viewers.forEach(fn => fn()); authorized.forEach(fn => fn(auth[state])); };
    const ext = {
      onAuthorized(fn) { authorized.push(fn); queueMicrotask(() => fn(auth[state])); },
      onContext(fn) { contexts.push(fn); queueMicrotask(() => fn({ theme: 'dark', isPaused: !playing }, ['theme', 'isPaused'])); },
      onVisibilityChanged(fn) { visibility.push(fn); queueMicrotask(() => fn(visible)); },
      viewer: { get isLinked() { return state === 'shared'; }, role: 'viewer', onChanged(fn) { viewers.push(fn); } },
      features: { isBitsEnabled: ${JSON.stringify(bits)}, onChanged(fn) { features.push(fn); } },
      actions: { requestIdShare() { shareRequests++; if (state === 'unshared') { state = 'shared'; queueMicrotask(notifyAuth); } } },
      listen(topic, fn) { listeners.push({ topic, fn }); },
      bits: { getProducts: async () => [], useBits() {}, onTransactionComplete(fn) { complete.push(fn); }, onTransactionCancelled(fn) { cancelled.push(fn); } }
    };
    window.Twitch = { ext };
    window.__panelHarness = {
      setIdentity(next) { if (!auth[next]) throw Error('Unknown identity'); state = next; notifyAuth(); },
      setVisible(next) { visible = !!next; visibility.forEach(fn => fn(visible)); },
      setPlaying(next) { playing = !!next; contexts.forEach(fn => fn({ isPaused: !playing }, ['isPaused'])); },
      publish(topic, message) { listeners.filter(item => item.topic === topic).forEach(item => item.fn(topic, 'application/json', typeof message === 'string' ? message : JSON.stringify(message))); },
      transactionComplete(event) { complete.forEach(fn => fn(event)); }, transactionCancelled(event) { cancelled.forEach(fn => fn(event)); },
      get shareRequests() { return shareRequests; }
    };
  })();`;
}
