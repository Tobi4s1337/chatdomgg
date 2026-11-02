// A small ElevenLabs REST client for the teaser's voice and sound work.
//
// The key is read only from process.env.ELEVENLABS_API_KEY, which comes from
// ~/.config/chatdom/elevenlabs.env through `node --env-file=...`. It is never
// printed, logged, written to disk or put in an error message. Request headers
// are never logged or stored.
//
// Every paid request (text to speech, sound effects) is cached on disk by a hash
// of (endpoint, voice, model, settings, text, output format and any other body
// field). A cache hit costs nothing, so re-running a script is free. The free
// voice lookup is cached too; the subscription read is always live, because its
// whole job is to report the account's current usage.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, linkSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const API_BASE = 'https://api.elevenlabs.io';
export const MEDIA_ROOT = '/srv/chatdom/media/teaser';
export const VOICE_DIR = join(MEDIA_ROOT, 'audio/voice');
export const SFX_DIR = join(MEDIA_ROOT, 'audio/sfx');
export const CACHE_DIR = join(VOICE_DIR, 'cache');
export const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_192';
export const FALLBACK_OUTPUT_FORMAT = 'mp3_44100_128';

/** Voice ids from ELEVENLABS_VOICE_CANDIDATES (comma or space separated). Voice ids are not secret. */
export function candidateVoices() {
  const raw = process.env.ELEVENLABS_VOICE_CANDIDATES ?? '';
  const ids = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('ELEVENLABS_VOICE_CANDIDATES is empty; run with --env-file=$HOME/.config/chatdom/elevenlabs.env');
  return ids;
}

function apiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set; run with --env-file=$HOME/.config/chatdom/elevenlabs.env');
  return key;
}

/** Stable JSON: object keys sorted, so the same request always hashes the same. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function cacheKey(parts) {
  return createHash('sha256').update(stable(parts)).digest('hex').slice(0, 32);
}

function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/** Response headers worth keeping (no request headers, nothing secret). */
function keptResponseHeaders(res) {
  const out = {};
  for (const name of ['request-id', 'x-character-count', 'character-cost', 'history-item-id', 'content-type']) {
    const v = res.headers.get(name);
    if (v != null) out[name] = v;
  }
  return out;
}

class ElevenError extends Error {
  constructor(status, endpoint, body) {
    // The body is the API's own error text; it never contains our key.
    super(`ElevenLabs ${endpoint} failed with HTTP ${status}: ${String(body).slice(0, 600)}`);
    this.status = status;
    this.endpoint = endpoint;
    this.body = String(body).slice(0, 2000);
  }
}

async function call(method, endpoint, { query, body } = {}) {
  const url = new URL(endpoint, API_BASE);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      'xi-api-key': apiKey(),
      accept: 'application/json, audio/mpeg',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ElevenError(res.status, endpoint, await res.text().catch(() => ''));
  return res;
}

/** Hard-link (or copy) a cached file to a named output path. */
export function place(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) rmSync(to);
  try {
    linkSync(from, to);
  } catch {
    copyFileSync(from, to);
  }
  return to;
}

/**
 * Text to speech with character timestamps.
 * POST /v1/text-to-speech/{voice_id}/with-timestamps
 * Returns { mp3, json, meta, cached }. meta holds alignment, normalized_alignment,
 * the request (minus anything secret) and kept response headers.
 */
export async function tts({
  voiceId,
  text,
  modelId = 'eleven_multilingual_v2',
  voiceSettings,
  outputFormat = DEFAULT_OUTPUT_FORMAT,
  seed,
  previousText,
  nextText,
  languageCode,
  applyTextNormalization,
}) {
  if (!voiceId || !text) throw new Error('tts needs voiceId and text');
  const endpoint = `/v1/text-to-speech/${voiceId}/with-timestamps`;
  const body = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings,
    seed,
    previous_text: previousText,
    next_text: nextText,
    language_code: languageCode,
    apply_text_normalization: applyTextNormalization,
  };
  const key = cacheKey({ endpoint: '/v1/text-to-speech/{voice_id}/with-timestamps', voice: voiceId, model: modelId, settings: voiceSettings ?? null, text, outputFormat, body });
  const mp3 = join(CACHE_DIR, 'tts', `${key}.mp3`);
  const json = join(CACHE_DIR, 'tts', `${key}.json`);
  if (existsSync(mp3) && existsSync(json)) {
    return { mp3, json, meta: JSON.parse(readFileSync(json, 'utf8')), cached: true, key };
  }
  const res = await call('POST', endpoint, { query: { output_format: outputFormat }, body });
  const headers = keptResponseHeaders(res);
  const data = await res.json();
  if (!data.audio_base64) throw new Error(`ElevenLabs ${endpoint} returned no audio`);
  const meta = {
    kind: 'tts',
    created: new Date().toISOString(),
    request: { endpoint: '/v1/text-to-speech/{voice_id}/with-timestamps', voiceId, outputFormat, ...body },
    response: headers,
    characters: text.length,
    alignment: data.alignment ?? null,
    normalized_alignment: data.normalized_alignment ?? null,
  };
  writeAtomic(mp3, Buffer.from(data.audio_base64, 'base64'));
  writeAtomic(json, JSON.stringify(meta, null, 1));
  return { mp3, json, meta, cached: false, key };
}

/**
 * Sound effect.
 * POST /v1/sound-generation
 */
export async function soundEffect({ text, durationSeconds, promptInfluence = 0.3, loop = false, modelId, outputFormat = DEFAULT_OUTPUT_FORMAT }) {
  if (!text) throw new Error('soundEffect needs text');
  const endpoint = '/v1/sound-generation';
  const body = { text, duration_seconds: durationSeconds, prompt_influence: promptInfluence, loop, model_id: modelId };
  const key = cacheKey({ endpoint, voice: null, model: modelId ?? null, settings: { durationSeconds, promptInfluence, loop }, text, outputFormat, body });
  const mp3 = join(CACHE_DIR, 'sfx', `${key}.mp3`);
  const json = join(CACHE_DIR, 'sfx', `${key}.json`);
  if (existsSync(mp3) && existsSync(json)) {
    return { mp3, json, meta: JSON.parse(readFileSync(json, 'utf8')), cached: true, key };
  }
  const res = await call('POST', endpoint, { query: { output_format: outputFormat }, body });
  const headers = keptResponseHeaders(res);
  const audio = Buffer.from(await res.arrayBuffer());
  const meta = { kind: 'sfx', created: new Date().toISOString(), request: { endpoint, outputFormat, ...body }, response: headers };
  writeAtomic(mp3, audio);
  writeAtomic(json, JSON.stringify(meta, null, 1));
  return { mp3, json, meta, cached: false, key };
}

/**
 * A voice's library name, labels and description. Free; cached unless refresh.
 * GET /v1/voices/{voice_id} for voices in the account; a Voice Library voice that was never added
 * to the account is found through GET /v1/shared-voices?search={voice_id} instead.
 */
export async function getVoice(voiceId, { refresh = false } = {}) {
  const path = join(CACHE_DIR, 'voices', `${cacheKey({ endpoint: '/v1/voices/{voice_id}', voice: voiceId })}.json`);
  if (!refresh && existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  let kept;
  try {
    const v = await (await call('GET', `/v1/voices/${voiceId}`)).json();
    kept = {
      voice_id: v.voice_id,
      name: v.name,
      in_account: true,
      category: v.category,
      description: v.description ?? null,
      labels: v.labels ?? {},
      preview_url: v.preview_url ?? null,
      high_quality_base_model_ids: v.high_quality_base_model_ids ?? [],
    };
  } catch (err) {
    if (!(err instanceof ElevenError) || (err.status !== 400 && err.status !== 404)) throw err;
    const j = await (await call('GET', '/v1/shared-voices', { query: { page_size: 5, search: voiceId } })).json();
    const v = (j.voices ?? []).find((x) => x.voice_id === voiceId);
    if (!v) throw new Error(`Voice ${voiceId} is neither in the account nor in the Voice Library`, { cause: err });
    kept = {
      voice_id: v.voice_id,
      name: v.name,
      in_account: false,
      category: v.category,
      description: v.description ?? null,
      labels: { gender: v.gender, age: v.age, accent: v.accent, descriptive: v.descriptive, use_case: v.use_case, language: v.language },
      preview_url: v.preview_url ?? null,
      high_quality_base_model_ids: [],
    };
  }
  kept.fetched = new Date().toISOString();
  writeAtomic(path, JSON.stringify(kept, null, 1));
  return kept;
}

/** GET /v1/models: which models do text to speech. Free. */
export async function listModels() {
  const res = await call('GET', '/v1/models');
  const models = await res.json();
  return models.map((m) => ({
    model_id: m.model_id,
    name: m.name,
    can_do_text_to_speech: m.can_do_text_to_speech,
    max_characters_request_subscribed_user: m.max_characters_request_subscribed_user,
    character_cost_multiplier: m.model_rates?.character_cost_multiplier ?? null,
  }));
}

/** GET /v1/user/subscription: live usage. Only usage fields are returned. Needs the key's user_read permission. */
export async function getSubscription() {
  const res = await call('GET', '/v1/user/subscription');
  const s = await res.json();
  return {
    tier: s.tier,
    character_count: s.character_count,
    character_limit: s.character_limit,
    next_character_count_reset_unix: s.next_character_count_reset_unix,
    status: s.status,
    read: new Date().toISOString(),
  };
}

/** Usage counted from this instant on (the lane's start), for the usage-stats fallback. */
export const USAGE_WINDOW_START = Date.parse('2026-10-01T00:00:00Z');

/**
 * The account's usage now, in credits.
 * First choice is the subscription endpoint (character_count, this billing period). The teaser's key
 * has no user_read permission, so the fallback is GET /v1/usage/character-stats: cumulative credits
 * since USAGE_WINDOW_START. The source is reported with the number.
 */
export async function readUsage() {
  try {
    const s = await getSubscription();
    return { source: 'subscription', credits: s.character_count, limit: s.character_limit, read: s.read };
  } catch (err) {
    if (!(err instanceof ElevenError) || (err.status !== 401 && err.status !== 403)) throw err;
  }
  const res = await call('GET', '/v1/usage/character-stats', {
    query: { start_unix: USAGE_WINDOW_START, end_unix: Date.now(), aggregation_interval: 'cumulative', metric: 'credits' },
  });
  const j = await res.json();
  const series = j.usage?.All ?? Object.values(j.usage ?? {})[0] ?? [];
  const credits = series.length ? Number(series[series.length - 1]) : 0;
  return { source: 'usage-stats', credits, limit: null, read: new Date().toISOString() };
}

/** Credits one fresh request was billed, from its response headers (null when the header is absent). */
export function billed(result) {
  const h = result?.meta?.response ?? {};
  const v = h['character-cost'] ?? h['x-character-count'];
  return v == null ? null : Number(v);
}

// ---------------------------------------------------------------------------
// The ledger: work/lanes/teaser/voice-ledger.md

export const LEDGER_PATH = new URL('../../../work/lanes/teaser/voice-ledger.md', import.meta.url).pathname;
export const LANE_BUDGET = 40000;

/** Sum of the "Used" column already in the ledger. */
export function ledgerUsed() {
  if (!existsSync(LEDGER_PATH)) return 0;
  let total = 0;
  for (const line of readFileSync(LEDGER_PATH, 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // | When | Purpose | Voice | Model | Requests (new/cached) | Characters sent | Before | After | Used |
    if (cells.length >= 10 && /^\d{4}-\d\d-\d\d/.test(cells[1])) {
      const used = Number(cells[9]);
      if (Number.isFinite(used)) total += used;
    }
  }
  return total;
}

/** Refuse to start a batch that would pass the lane's cap. */
export function assertBudget(estimate) {
  const used = ledgerUsed();
  if (used + estimate > LANE_BUDGET) {
    throw new Error(`Lane budget: ${used} credits used, this batch estimates ${estimate}, the cap is ${LANE_BUDGET}. needs: tobias raise the ElevenLabs budget`);
  }
  return used;
}

export function appendLedger({ purpose, voice, model, fresh, cached, characters, before, after, used }) {
  const header = [
    '# ElevenLabs ledger, teaser lane',
    '',
    "The account's usage is read before and after each batch. The teaser's key has no permission to read the subscription endpoint, so usage comes from `GET /v1/usage/character-stats` (cumulative credits since 2026-10-01, the whole account); the client still tries the subscription endpoint first. That account total can lag and includes anything else spent on the account at the same time. \"Used\" is what this batch was billed: the sum of the `character-cost` response header over its fresh requests, falling back to after minus before when the header is missing. Cached requests cost nothing.",
    '',
    `The lane's cap is ${LANE_BUDGET.toLocaleString('en-GB')} credits, summed over the Used column. Nothing secret is written here.`,
    '',
    '| When (UTC) | Purpose | Voice | Model | Requests (new/cached) | Characters sent | Account before | Account after | Used |',
    '|---|---|---|---|---|---|---|---|---|',
    '',
  ].join('\n');
  let text = existsSync(LEDGER_PATH) ? readFileSync(LEDGER_PATH, 'utf8') : header;
  if (!text.endsWith('\n')) text += '\n';
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const row = `| ${when} | ${purpose} | ${voice} | ${model} | ${fresh}/${cached} | ${characters} | ${before} | ${after} | ${used} |\n`;
  // Rows go right after the table, before any notes below it.
  const lines = text.split('\n');
  let last = -1;
  lines.forEach((l, i) => {
    if (l.startsWith('|')) last = i;
  });
  if (last === -1) text += row;
  else {
    lines.splice(last + 1, 0, row.trimEnd());
    text = lines.join('\n');
  }
  writeAtomic(LEDGER_PATH, text);
}

/**
 * Run a batch between two usage reads and log it.
 * `work` gets `count(result, characters)` to tally each request; characters and credits are summed only
 * for fresh (uncached) requests.
 */
export async function batch({ purpose, voice, model, estimate }, work) {
  assertBudget(estimate);
  const before = (await readUsage()).credits;
  const tally = { fresh: 0, cached: 0, characters: 0, billed: 0, billedKnown: true };
  const count = (r, chars) => {
    if (r.cached) tally.cached += 1;
    else {
      tally.fresh += 1;
      tally.characters += chars ?? 0;
      const b = billed(r);
      if (b == null) tally.billedKnown = false;
      else tally.billed += b;
    }
    return r;
  };
  let result;
  let failure;
  try {
    result = await work(count);
  } catch (err) {
    failure = err;
  }
  let after = (await readUsage()).credits;
  // The usage total lags a few seconds behind; when no billed header is available, wait for it to move.
  for (let i = 0; i < 6 && tally.fresh > 0 && !tally.billedKnown && after === before; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    after = (await readUsage()).credits;
  }
  const used = tally.fresh === 0 ? 0 : tally.billedKnown ? tally.billed : after - before;
  if (tally.fresh > 0) {
    appendLedger({ purpose: failure ? `${purpose} (stopped on an error)` : purpose, voice, model, fresh: tally.fresh, cached: tally.cached, characters: tally.characters, before, after, used });
  }
  if (failure) throw failure;
  return { result, before, after, used, ...tally };
}
