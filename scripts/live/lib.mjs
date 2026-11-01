// Shared pieces of the live-Twitch commands: where the bench is, how a delivery is signed like Twitch signs it,
// how the Twitch CLI writes a payload, and how to watch the kingdom's public stream for what arrived.
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const BENCH = Object.freeze({
  kingdomId: '129634568',
  kingdomName: 'Willowmere',
  schema: 'live_twitch_bench',
  realmPort: 5198,
  webPort: 5199,
  doorPort: 5175,
  // Only when no adopted layout exists to copy.
  fallbackConfig: { seed: 'tobi4s_', tier: 'town', firstYear: 2019, year: 2026 },
});
/** The running LIVE realm (main's). The commands only ever read its public watch. */
export const LIVE = Object.freeze({ realm: 'http://127.0.0.1:5197' });

export function stateDir() {
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'chatdom/live-twitch-bench');
}
export function readState() {
  const file = join(stateDir(), 'state.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
function doorSecret() {
  const secret = readState()?.secrets?.door;
  if (!secret) throw new Error('The bench is not set up; run scripts/live/bench.mjs up first.');
  return secret;
}

export async function health() {
  const probe = async (url) => {
    try {
      const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(15_000) });
      const text = await response.text();
      let body = null; try { body = JSON.parse(text); } catch { body = null; }
      return { ok: response.ok, status: response.status, ...(body ? { body } : {}) };
    } catch (error) { return { ok: false, error: String(error?.cause?.code ?? error?.message ?? error) }; }
  };
  const [realm, door, web] = await Promise.all([
    probe(`http://127.0.0.1:${BENCH.realmPort}/readyz`),
    probe(`http://127.0.0.1:${BENCH.doorPort}/health`),
    probe(`http://127.0.0.1:${BENCH.webPort}/`),
  ]);
  return { realm, door: { ok: door.ok, ...(door.body ? { door: door.body.door, realm: door.body.realm } : { error: door.error }) }, web: { ok: web.ok } };
}

/** A payload exactly as `twitch event trigger` writes it (`-D`: no config, printed instead of sent). */
export function cliEvent(type, flags = []) {
  const out = execFileSync('twitch', ['event', 'trigger', type, '-D', ...flags], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('{')));
}

/** Twitch CLI forwards the event to the door itself, signed with the bench's secret. */
export function cliForward(type, flags = []) {
  execFileSync('twitch', ['event', 'trigger', type, '-F', `http://127.0.0.1:${BENCH.doorPort}/eventsub`, '-s', doorSecret(), ...flags],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** POST one notification the way Twitch's webhook transport does: message ID, timestamp, HMAC over both and the body. */
export async function deliver(payload, { messageId = randomUUID(), at = new Date() } = {}) {
  const body = JSON.stringify(payload), stamp = at.toISOString();
  const signature = `sha256=${createHmac('sha256', doorSecret()).update(messageId + stamp + body).digest('hex')}`;
  const response = await fetch(`http://127.0.0.1:${BENCH.doorPort}/eventsub`, { method: 'POST', body, headers: {
    'Content-Type': 'application/json', 'Twitch-Eventsub-Message-Id': messageId, 'Twitch-Eventsub-Message-Timestamp': stamp,
    'Twitch-Eventsub-Message-Signature': signature, 'Twitch-Eventsub-Message-Type': 'notification',
    'Twitch-Eventsub-Subscription-Type': payload.subscription.type, 'Twitch-Eventsub-Subscription-Version': payload.subscription.version,
  } });
  if (response.status !== 204) throw new Error(`the door refused the delivery (${response.status})`);
  return messageId;
}

/** A `channel.chat.message` v1 notification (the CLI cannot write one), shaped like Twitch's documented example. */
export function chatMessage({ kingdomId = BENCH.kingdomId, personId, login, name, text, messageId = randomUUID() }) {
  return {
    subscription: { id: randomUUID(), status: 'enabled', type: 'channel.chat.message', version: '1',
      condition: { broadcaster_user_id: kingdomId, user_id: '900000999' }, transport: { method: 'webhook', callback: 'null' }, created_at: new Date().toISOString(), cost: 0 },
    event: {
      broadcaster_user_id: kingdomId, broadcaster_user_login: 'tobi4s_', broadcaster_user_name: 'tobi4s_',
      chatter_user_id: personId, chatter_user_login: login, chatter_user_name: name, message_id: messageId,
      message: { text, fragments: [{ type: 'text', text, cheermote: null, emote: null, mention: null }] },
      color: '#8A2BE2', badges: [], message_type: 'text', cheer: null, reply: null, channel_points_custom_reward_id: null,
      source_broadcaster_user_id: null, source_broadcaster_user_login: null, source_broadcaster_user_name: null, source_message_id: null, source_badges: null,
    },
  };
}

/**
 * The kingdom's public watch (`/api/realm/watch/:id`), the same stream the stream view reads. Resolves the first
 * time `match` returns a value for the checkpoint or a later delivery, or rejects after `timeoutMs`.
 */
export async function watchFor(match, { realm = `http://127.0.0.1:${BENCH.realmPort}`, kingdomId = BENCH.kingdomId, timeoutMs = 30_000, onCheckpoint } = {}) {
  const controller = new globalThis.AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    // A kingdom that is not held opens on the first watch; its approved geometry may take a while to prepare.
    for (;;) {
      response = await fetch(`${realm}/api/realm/watch/${kingdomId}`, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
      if (response.status !== 503) break;
      await response.body?.cancel();
      await sleep(1_000);
    }
    if (!response.ok || !response.body) throw new Error(`the kingdom watch answered ${response.status}`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !data) continue;
        const value = JSON.parse(data);
        if (event === 'checkpoint') onCheckpoint?.(value);
        const found = match(event, value);
        if (found !== undefined && found !== null && found !== false) return found;
      }
    }
    throw new Error('the kingdom watch closed');
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`nothing reached the kingdom within ${Math.round(timeoutMs / 1000)} s`, { cause: error });
    throw error;
  } finally { clearTimeout(timer); controller.abort(); }
}

/** A delivered moment fact of this kind (and optional key), as the watch carries it. */
export const momentOf = (kind, test = () => true) => (event, value) => {
  if (event !== 'world' || value?.message?.type !== 'moment') return null;
  const fact = value.message.fact;
  return fact?.body?.kind === kind && test(fact) ? fact : null;
};

/** Counts of the checkpoint's settled homes and lit windows. */
export function census(checkpoint) {
  const current = Array.isArray(checkpoint?.checkpoint?.current) ? checkpoint.checkpoint.current : [];
  const presence = current.find(m => m?.type === 'presence')?.frame;
  // Every settled home has its window in the presence frame (the house itself is in the founded scene).
  const homes = Array.isArray(presence?.windows) ? presence.windows.length : 0;
  const lit = Array.isArray(presence?.windows) ? presence.windows.filter(window => window?.present).length : null;
  return { homes, lit, origin: presence?.origin ?? null };
}

export function report(lines) { for (const line of lines) console.info(line); }
export function label(fact) { return fact?.origin === 'live' ? 'LIVE' : 'SIMULATED'; }
export function args(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
}
export const flag = name => process.argv.includes(`--${name}`);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Open the kingdom's watch, wait for its checkpoint, then `fire`; resolves with what `match` found in a later
 * delivery and the milliseconds from firing to its arrival on the watch.
 */
export async function fireAndWatch(fire, match, options = {}) {
  let ready, checkpoint = null;
  const opened = new Promise(resolve => { ready = resolve; });
  let firedAt = 0;
  const watching = watchFor((event, value) => firedAt > 0 ? match(event, value) : null, {
    ...options, onCheckpoint: value => { checkpoint = value; ready(); },
  });
  watching.catch(() => ready());
  await opened;
  firedAt = performance.now();
  const fired = await fire();
  const found = await watching;
  return { found, fired, ms: Math.round(performance.now() - firedAt), checkpoint };
}

/** SIMULATED chatters for the bench; numeric IDs in a range Twitch has not issued. */
export const SIMULATED_CHATTERS = [
  'Wrenna', 'Bramblecat', 'Oskar_Fen', 'mossling', 'Tidewright', 'Quillon', 'hearthbound', 'Saffie_Lune', 'Corvel', 'pinewhistle',
  'Ilsabet', 'Dunmore', 'larkspur_jo', 'Ottilie', 'Fennick', 'Marlowe_Vey', 'emberleaf', 'Sorrel', 'Halvard', 'nettlewick',
  'Juniper_Ash', 'Bastian_K', 'Merriwen', 'Thistledown', 'cobble_rae', 'Elowen', 'Garrick', 'wisteria_m', 'Rook', 'Pellam',
  'Isolde_Fae', 'Tamsin', 'brindle', 'Cassius_Wold', 'Linnea', 'Ferris', 'quietfox', 'Rowena_Belle', 'Aldric', 'sundew',
].map((name, index) => ({ personId: String(990000100 + index), login: name.toLowerCase(), name }));
