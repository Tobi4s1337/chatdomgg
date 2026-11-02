import { GIFT_CATALOGUE } from '../src/gifts/catalogue.ts';
import { AdminError, cli, createAdmin, credentials, isMain, options } from './twitch-admin.mjs';

/** Bands are voluntary amounts for the same shared effect; never larger outcomes. */
export const PRODUCTS = GIFT_CATALOGUE.flatMap(gift => gift.bands.map(band => ({
  sku: band.id, cost: { amount: band.suggestedBits, type: 'bits' }, display_name: gift.title,
  in_development: true, is_broadcast: true,
})));

export function productPlan(existing) {
  if (!Array.isArray(existing) || existing.some(p => !p || typeof p.sku !== 'string') || new Set(existing.map(p => p.sku)).size !== existing.length) throw new AdminError('Invalid Twitch product catalogue.');
  return PRODUCTS.map(product => {
    const previous = existing.find(p => p.sku === product.sku);
    let action = 'create';
    if (previous) {
      // Preserve released and retired products, including their amounts. No release flag exists.
      if (previous.in_development !== true || previous.expiration) action = 'blocked';
      else action = previous.cost?.amount === product.cost.amount && previous.cost?.type === 'bits' && previous.display_name === product.display_name && previous.is_broadcast === true ? 'unchanged' : 'update';
    }
    return { action, product };
  });
}

export async function run(args = process.argv.slice(2), { env = process.env, fetch, log = console.log } = {}) {
  const flags = options(args);
  if (flags.help) { log('node --experimental-strip-types apps/panel/scripts/register-products.mjs [--inspect | --apply]\nDefault: offline dry run. --inspect: authenticate/read/compare only. --apply: compare then write development products. Released/retired SKUs block the whole write. No release option.'); return; }
  if (!flags.apply && !flags.inspect) {
    log(JSON.stringify({ mode: 'offline dry run', network: false, comparison: 'Pending; use --inspect to read Twitch before applying.', products: PRODUCTS }, null, 2)); return;
  }
  const admin = createAdmin(credentials(env), { fetch });
  const existing = await admin.request('/bits/extensions?should_include_all=true');
  const plan = productPlan(existing.data);
  log(JSON.stringify({ mode: flags.apply ? 'apply' : 'inspect; no mutations', plan }, null, 2));
  if (flags.apply) {
    if (plan.some(item => item.action === 'blocked')) throw new AdminError('Released or retired catalogue SKU found; no products were written. Review it separately in the console.');
    for (const item of plan) if (['create', 'update'].includes(item.action)) await admin.request('/bits/extensions', { method: 'PUT', body: item.product });
    log('Development catalogue applied. No product was released.');
  }
}

if (isMain(import.meta.url)) await cli(() => run());
