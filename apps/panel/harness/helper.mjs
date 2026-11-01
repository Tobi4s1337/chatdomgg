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
const skuPattern = /^[a-zA-Z0-9_-]{1,255}$/;
function productOptions(products) {
  if (!Array.isArray(products) || products.length > 100) throw new Error('Invalid harness products');
  const seen = new Set();
  return products.map(product => {
    if (!product || typeof product !== 'object' || Array.isArray(product)
      || Object.keys(product).some(key => !['sku', 'cost', 'expiration', 'isBroadcast'].includes(key))
      || typeof product.sku !== 'string' || !skuPattern.test(product.sku) || seen.has(product.sku)
      || !product.cost || typeof product.cost !== 'object' || Array.isArray(product.cost)
      || Object.keys(product.cost).some(key => !['amount', 'type'].includes(key)) || product.cost.type !== 'bits'
      || !((typeof product.cost.amount === 'number' && Number.isInteger(product.cost.amount))
        || (typeof product.cost.amount === 'string' && /^[1-9]\d{0,4}$/.test(product.cost.amount)))
      || Number(product.cost.amount) < 1 || Number(product.cost.amount) > 10000
      || (product.expiration !== undefined && product.expiration !== null && (typeof product.expiration !== 'string' || !Number.isFinite(Date.parse(product.expiration))))
      || (product.isBroadcast !== undefined && typeof product.isBroadcast !== 'boolean')) throw new Error('Invalid harness product');
    seen.add(product.sku);
    return { sku: product.sku, cost: { amount: product.cost.amount, type: 'bits' },
      ...(product.expiration !== undefined ? { expiration: product.expiration } : {}),
      ...(product.isBroadcast !== undefined ? { isBroadcast: product.isBroadcast } : {}) };
  });
}
/** Node-only simulated provider receipt. The signing secret never enters generated browser source. */
export function signTransactionReceipt(secret, { extensionId, transactionId, userId, sku, bits, occurredAt, inDevelopment }) {
  if (typeof extensionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(extensionId)
    || typeof transactionId !== 'string' || !skuPattern.test(transactionId)
    || typeof userId !== 'string' || !/^\d{1,32}$/.test(userId)
    || typeof sku !== 'string' || !skuPattern.test(sku)
    || !Number.isInteger(bits) || bits < 1 || bits > 10000 || typeof inDevelopment !== 'boolean'
    || !((typeof occurredAt === 'number' && Number.isFinite(occurredAt))
      || (typeof occurredAt === 'string' && Number.isFinite(Date.parse(occurredAt))))) throw new Error('Invalid harness receipt');
  const time = new Date(occurredAt).toISOString();
  // Twitch's documented transaction receipt topic and domainID spelling; no channel claim.
  return sign(secret, { topic: 'bits_transaction_receipt', exp: Math.floor(Date.now() / 1000) + 300,
    data: { transactionId, time, userId, product: { domainID: `twitch.ext.${extensionId}`, sku,
      cost: { amount: bits, type: 'bits' }, inDevelopment } } });
}
export function helperSource(secret, options = {}) {
  const { channel = '1234', user = '5678', client = 'panel-lane', identity = 'unshared', visible = true, playing = true, bits = false, role = 'viewer' } = options;
  if (!['logged-out', 'unshared', 'shared'].includes(identity)) throw new Error('Unknown identity');
  if (!['viewer', 'moderator', 'broadcaster'].includes(role)) throw new Error('Unknown role');
  // Products come only from a direct Node harness option, never a viewer URL or production catalogue.
  const products = productOptions(options.products === undefined ? [] : options.products);
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const auth = {};
  for (const state of ['logged-out', 'unshared', 'shared']) {
    const opaque = state === 'logged-out' ? 'Alaneviewer' : 'Ulaneviewer';
    const claims = { channel_id: channel, opaque_user_id: opaque, role, exp: expires, pubsub_perms: { listen: ['broadcast'], send: [] }, ...(state === 'shared' ? { user_id: user } : {}) };
    auth[state] = { channelId: channel, clientId: client, userId: opaque, token: sign(secret, claims), helixToken: '' };
  }
  // The signed tokens are held in this closure only; none enter a URL, DOM, storage, or log.
  return `(() => {
    const auth = ${JSON.stringify(auth)};
    const products = ${JSON.stringify(products)};
    let state = ${JSON.stringify(identity)}, visible = ${JSON.stringify(visible)}, playing = ${JSON.stringify(playing)};
    const authorized = [], viewers = [], contexts = [], visibility = [], features = [], listeners = [], complete = [], cancelled = [], configurationChanged = [];
    let broadcasterConfiguration;
    let shareRequests = 0, bitsRequests = 0, selectedSku = null, pendingSku = null;
    const notifyAuth = () => { viewers.forEach(fn => fn()); authorized.forEach(fn => fn(auth[state])); };
    const ext = {
      onAuthorized(fn) { authorized.push(fn); queueMicrotask(() => fn(auth[state])); },
      onContext(fn) { contexts.push(fn); queueMicrotask(() => fn({ theme: 'dark', isPaused: !playing }, ['theme', 'isPaused'])); },
      onVisibilityChanged(fn) { visibility.push(fn); queueMicrotask(() => fn(visible)); },
      viewer: { get isLinked() { return state === 'shared'; }, role: ${JSON.stringify(role)}, onChanged(fn) { viewers.push(fn); } },
      features: { isBitsEnabled: ${JSON.stringify(bits)}, onChanged(fn) { features.push(fn); } },
      actions: { requestIdShare() { shareRequests++; if (state === 'unshared') { state = 'shared'; queueMicrotask(notifyAuth); } } },
      listen(topic, fn) { listeners.push({ topic, fn }); },
      configuration: {
        get broadcaster() { return broadcasterConfiguration; },
        onChanged(fn) { configurationChanged.push(fn); queueMicrotask(fn); },
        set(segment, version, content) {
          if (${JSON.stringify(role)} !== 'broadcaster' || state !== 'shared' || segment !== 'broadcaster' || typeof version !== 'string' || typeof content !== 'string' || new TextEncoder().encode(content).length > 5120) throw Error('Configuration write refused');
          broadcasterConfiguration = { version, content };
          queueMicrotask(() => configurationChanged.forEach(fn => fn()));
        }
      },
      bits: {
        getProducts: async () => products.map(product => ({ ...product, cost: { ...product.cost } })),
        useBits(sku) {
          if (!ext.features.isBitsEnabled || !products.some(product => product.sku === sku)) throw Error('Unknown or unavailable Bits product');
          if (pendingSku !== null) throw Error('A simulated Bits dialog is already pending');
          bitsRequests++; selectedSku = sku; pendingSku = sku;
        },
        onTransactionComplete(fn) { complete.push(fn); }, onTransactionCancelled(fn) { cancelled.push(fn); }
      }
    };
    window.Twitch = { ext };
    window.__panelHarness = {
      setIdentity(next) { if (!auth[next]) throw Error('Unknown identity'); state = next; notifyAuth(); },
      setVisible(next) { visible = !!next; visibility.forEach(fn => fn(visible)); },
      setPlaying(next) { playing = !!next; contexts.forEach(fn => fn({ isPaused: !playing }, ['isPaused'])); },
      publish(topic, message) { listeners.filter(item => item.topic === topic).forEach(item => item.fn(topic, 'application/json', typeof message === 'string' ? message : JSON.stringify(message))); },
      transactionComplete(event = {}) {
        if (pendingSku === null) return false;
        if (!event || typeof event !== 'object' || (event.product?.sku !== undefined && event.product.sku !== pendingSku)) throw Error('Completion does not match the simulated Bits dialog');
        const transaction = { ...event, product: { ...event.product, sku: pendingSku }, initiator: 'current_user' };
        pendingSku = null;
        complete.forEach(fn => fn(transaction, { isTransactionCurrentUser: true }));
        return true;
      },
      transactionCancelled() {
        if (pendingSku === null) return false;
        pendingSku = null; cancelled.forEach(fn => fn()); return true;
      },
      get bitsRequests() { return bitsRequests; }, get selectedSku() { return selectedSku; }, get pendingSku() { return pendingSku; },
      get shareRequests() { return shareRequests; }
    };
  })();`;
}
