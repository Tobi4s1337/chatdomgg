import { AdminError, BITS_TYPE, callbackUrl, cli, createAdmin, credentials, isMain, options, subscriptions, webhookSecret } from './twitch-admin.mjs';

export function subscriptionPlan(existing, clientId, callback) {
  const target = existing.filter(s => s.type === BITS_TYPE && s.version === '1' && s.condition?.extension_client_id === clientId);
  const exact = target.filter(s => s.transport?.method === 'webhook' && s.transport.callback === callback);
  if (exact.some(s => s.status === 'enabled')) return { action: 'unchanged', status: 'enabled' };
  if (exact.some(s => s.status === 'webhook_callback_verification_pending')) return { action: 'unchanged', status: 'webhook_callback_verification_pending' };
  if (target.length) return { action: 'blocked', reason: 'An existing subscription has a different transport/callback or needs repair. Review it in Twitch; nothing is deleted or duplicated.' };
  return { action: 'create' };
}

export async function run(args = process.argv.slice(2), { env = process.env, fetch, log = console.log } = {}) {
  const flags = options(args, { webhook: true });
  if (flags.help) { log('node apps/panel/scripts/subscribe-bits.mjs [--origin HTTPS_ORIGIN] [--callback HTTPS_URL] [--inspect | --apply]\nDefault: offline dry run with no credentials needed. --inspect: read all subscription pages only. --apply: create only if absent; never delete or duplicate.'); return; }
  const callback = callbackUrl(flags.origin, flags.callback);
  const publicRequest = { type: BITS_TYPE, version: '1', condition: { extension_client_id: 'from TWITCH_EXTENSION_CLIENT_ID' }, transport: { method: 'webhook', callback, secret: '[REDACTED; derived privately]' } };
  if (!flags.apply && !flags.inspect) { log(JSON.stringify({ mode: 'offline dry run', network: false, comparison: 'Pending; use --inspect to read Twitch before applying.', request: publicRequest }, null, 2)); return; }
  const config = credentials(env), admin = createAdmin(config, { fetch });
  const plan = subscriptionPlan(await subscriptions(admin), config.clientId, callback);
  log(JSON.stringify({ mode: flags.apply ? 'apply' : 'inspect; no mutations', plan, request: publicRequest }, null, 2));
  if (!flags.apply || plan.action === 'unchanged') return;
  if (plan.action === 'blocked') throw new AdminError('Existing Bits subscription needs operator review; no subscription was created.');
  const body = { ...publicRequest, condition: { extension_client_id: config.clientId }, transport: { method: 'webhook', callback, secret: webhookSecret(config.secret) } };
  try {
    const result = await admin.request('/eventsub/subscriptions', { method: 'POST', body });
    const state = result.data?.[0]?.status;
    if (!['enabled', 'webhook_callback_verification_pending'].includes(state)) throw new AdminError('Subscription response needs operator review.');
    log(`Bits subscription ${state}. Verify enabled status with --inspect; creation alone does not prove delivery.`);
  } catch (error) {
    if (!(error instanceof AdminError) || error.status !== 409) throw error;
    const raced = subscriptionPlan(await subscriptions(admin), config.clientId, callback);
    if (raced.action !== 'unchanged') throw new AdminError('Bits subscription conflict needs operator review; no replacement attempted.');
    log(`Bits subscription already exists (${raced.status}).`);
  }
}

if (isMain(import.meta.url)) await cli(() => run());
