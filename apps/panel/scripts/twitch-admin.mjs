/* global Buffer, AbortSignal, URLSearchParams */
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const BITS_TYPE = 'extension.bits_transaction.create';
export const WEBHOOK_LABEL = 'chatdom:extension-bits:v1';

export class AdminError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function credentials(env = process.env) {
  for (const key of ['TWITCH_EXTENSION_CLIENT_ID', 'TWITCH_EXTENSION_SECRET', 'TWITCH_EXTENSION_CLIENT_SECRET']) {
    if (!env[key]?.trim()) throw new AdminError(`Missing ${key}.`);
  }
  const clientId = env.TWITCH_EXTENSION_CLIENT_ID.trim();
  const secret = env.TWITCH_EXTENSION_SECRET.trim();
  if (!/^[a-zA-Z0-9]+$/.test(clientId)) throw new AdminError('Invalid TWITCH_EXTENSION_CLIENT_ID.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret) || Buffer.from(secret, 'base64').length < 32 || Buffer.from(secret, 'base64').toString('base64').replace(/=+$/, '') !== secret.replace(/=+$/, '')) {
    throw new AdminError('Invalid base64 TWITCH_EXTENSION_SECRET (at least 32 decoded bytes required).');
  }
  return { clientId, secret: Buffer.from(secret, 'base64'), clientSecret: env.TWITCH_EXTENSION_CLIENT_SECRET.trim() };
}

export function webhookSecret(secret) { return createHmac('sha256', secret).update(WEBHOOK_LABEL).digest('hex'); }

export function callbackUrl(origin = 'https://chatdom.io', callback) {
  let url;
  try { url = new URL(callback ?? '/api/panel/v1/bits-webhook', origin); }
  catch { throw new AdminError('Invalid webhook URL.'); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) {
    throw new AdminError('Webhook requires HTTPS on port 443 without credentials, query or fragment.');
  }
  return url.href;
}

/** No user-controlled values or provider bodies are included in errors or CLI diagnostics. */
export async function cli(main) {
  try { await main(); }
  catch (error) { process.stderr.write(`${error instanceof AdminError ? error.message : 'Operator command failed; no credentials were logged.'}\n`); process.exitCode = 1; }
}

export function isMain(url) { return !!process.argv[1] && pathToFileURL(process.argv[1]).href === url; }

export function options(args, { webhook = false } = {}) {
  const result = { apply: false, inspect: false, help: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') result.apply = true;
    else if (args[i] === '--inspect') result.inspect = true;
    else if (args[i] === '--help') result.help = true;
    else if (webhook && ['--origin', '--callback'].includes(args[i])) {
      const key = args[i].slice(2);
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new AdminError('Missing webhook URL option value.');
      result[key] = args[++i];
    } else throw new AdminError('Unknown option. Use --help.');
  }
  if (result.apply && result.inspect) throw new AdminError('Choose --inspect or --apply, not both.');
  return result;
}

/** Private in-memory app token; startup/hourly validation, one bounded retry after 401. */
export function createAdmin(config, { fetch: fetcher = globalThis.fetch, now = Date.now } = {}) {
  let token, validatedAt = -Infinity, expiresAt = 0;
  async function send(url, init) {
    try { return await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { throw new AdminError('Twitch request failed; response details withheld.'); }
  }
  async function json(response) {
    if (!response.ok) throw new AdminError(`Twitch returned HTTP ${response.status}; response details withheld.`, response.status);
    try { return await response.json(); } catch { throw new AdminError('Twitch returned invalid JSON; response details withheld.'); }
  }
  async function validate() {
    const value = await json(await send('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } }));
    if (value.client_id !== config.clientId || value.user_id || value.login) throw new AdminError('OAuth token does not belong to this extension app.');
    if (!Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new AdminError('OAuth token has no valid expiry.');
    validatedAt = now(); expiresAt = validatedAt + value.expires_in * 1000;
  }
  async function mint() {
    token = undefined; expiresAt = 0; validatedAt = -Infinity;
    const value = await json(await send('https://id.twitch.tv/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'client_credentials' }).toString(),
    }));
    if (typeof value.access_token !== 'string' || !value.access_token) throw new AdminError('Twitch did not issue an app token.');
    token = value.access_token;
    try { await validate(); } catch (error) { token = undefined; throw error; }
  }
  async function ready() {
    if (!token || now() >= expiresAt - 30_000) await mint();
    else if (now() - validatedAt >= 3_600_000) {
      try { await validate(); }
      catch (error) { token = undefined; if (error instanceof AdminError && error.status === 401) await mint(); else throw error; }
    }
  }
  async function request(path, { method = 'GET', body } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new AdminError('Invalid Helix path.');
    await ready();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await send(`https://api.twitch.tv/helix${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Client-Id': config.clientId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 && attempt === 0) { await mint(); continue; }
      return json(response);
    }
  }
  return { request };
}

export async function subscriptions(admin) {
  const all = [], cursors = new Set();
  let cursor;
  do {
    const query = new URLSearchParams({ type: BITS_TYPE, ...(cursor ? { after: cursor } : {}) });
    const page = await admin.request(`/eventsub/subscriptions?${query}`);
    if (!Array.isArray(page.data)) throw new AdminError('Invalid Twitch subscription list.');
    all.push(...page.data);
    cursor = page.pagination?.cursor;
    if (cursor && (typeof cursor !== 'string' || cursors.has(cursor) || cursors.size >= 1000)) throw new AdminError('Invalid Twitch pagination.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return all;
}
