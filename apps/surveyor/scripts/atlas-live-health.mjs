// The deploy's health gate (SEAMS.md "deploy:"): `node atlas-live-health.mjs <base>` exits 0 only when the Atlas service
// at <base> (http://127.0.0.1:5200 before the switch, https://chatdom.io after it) answers, its search register is warm,
// a channel outside the survey (ATLAS_HEALTH_LOGIN, default tobi4s_) is found and placed, its card stands at the same
// place, and a login Twitch cannot know is never invented. Every read is a public GET the browser makes itself; it
// spends at most two Twitch lookups on the service's own budget (both cached afterwards).
/* global AbortSignal */
import { performance } from 'node:perf_hooks';

const base = (process.argv[2] || 'http://127.0.0.1:5200').replace(/\/+$/, '');
const login = (process.env.ATLAS_HEALTH_LOGIN || 'tobi4s_').toLowerCase();
const warmFor = Number(process.env.ATLAS_HEALTH_WAIT_S || 120) * 1000;
const started = Date.now();
const lines = [];
let failed = false;

const note = (ok, text) => {
  lines.push(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed = true;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A 503 while the service starts or warms its register is retried until ATLAS_HEALTH_WAIT_S; anything else is final.
async function read(path) {
  for (;;) {
    const t0 = performance.now();
    let reply;
    try {
      reply = await fetch(`${base}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (Date.now() - started > warmFor) throw new Error(`${path}: ${error.message}`, { cause: error });
      await sleep(3_000);
      continue;
    }
    const ms = Math.round(performance.now() - t0);
    if (reply.status === 503 && Date.now() - started < warmFor) {
      await reply.body?.cancel();
      await sleep(3_000);
      continue;
    }
    const text = await reply.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* reported below */ }
    return { status: reply.status, body, ms };
  }
}

try {
  const health = await read('/map-data/v1/health');
  note(health.status === 200 && health.body?.ok === true, `health ${health.status} ${health.body?.revision ?? ''}`);
  const preview = await read('/map-data/v1/preview');
  const pv = preview.body?.id;
  note(preview.status === 200 && typeof pv === 'string', `preview ${preview.status} ${pv ?? ''}${preview.body?.edition ? ` (${preview.body.edition.label})` : ''}`);
  if (!pv) throw new Error('no preview to search');
  const root = `/map-data/v1/preview/${encodeURIComponent(pv)}`;

  const search = await read(`${root}/search?q=${encodeURIComponent(login)}&portraits=1&lookup=1`);
  const hit = search.body?.results?.find(r => r.channel?.login === login) ?? null;
  note(search.status === 200 && !search.body?.unavailable, `search ${search.status} in ${search.ms} ms${search.body?.unavailable ? ` unavailable: ${search.body.unavailable}` : ''}`);
  note(!!hit?.position && (hit.channel.place === 'waiting' || hit.channel.place === 'mapped'),
    `${login} ${hit ? `${hit.channel.place} at ${JSON.stringify(hit.position)}` : 'not found'}`);

  const card = await read(`${root}/card/login/${encodeURIComponent(login)}?portraits=1&lookup=1`);
  note(card.status === 200 && JSON.stringify(card.body?.position) === JSON.stringify(hit?.position ?? null),
    `card ${card.status} in ${card.ms} ms at ${JSON.stringify(card.body?.position ?? null)}`);
  if (card.body?.channel?.place === 'waiting') note(card.body.channel.tier == null, 'waiting card holds no land');

  // Twitch logins are 4-25 characters; this one is random each run, so a cached answer never hides an invention.
  const invented = `zq${Math.random().toString(36).slice(2, 14)}x${Date.now().toString(36)}`.slice(0, 25);
  const none = await read(`${root}/search?q=${invented}&portraits=1&lookup=1`);
  note(none.status === 200 && !none.body?.results?.some(r => r.channel?.login === invented), `made-up ${invented} not invented`);
} catch (error) {
  note(false, error instanceof Error ? error.message : String(error));
}

console.log(`atlas-live health ${base}\n${lines.join('\n')}\n${failed ? 'FAILED' : 'healthy'} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
