import { KingdomIdSchema, PIER_WATCH_ROUTE, type FishingCaughtFish, type PierFeedEvent, type PierFeedLine, type PierFeedWho, type Vec3 } from '@chatdom/shared';

/*
 * The pier's public feed, read from the realm's server-sent events: who has a float out, which floats have a bite or a
 * fight, and what came out of the water. The reducer keeps the current chat lines and turns every event into the beats
 * a view draws; the watcher keeps the stream open. Nothing here trusts the wire: a malformed event is dropped whole.
 */

/** Twitch's own display names are short; anything longer than this did not come from the realm. */
const NAME_LIMIT = 64, ID_LIMIT = 128, SPECIES_LIMIT = 64, LINES_LIMIT = 64, COORD_LIMIT = 1e6;
/** The honest "the pier is full" beat shows at most this often, by the realm's clock. */
export const PIER_FULL_GAP_MS = 20_000;
/** Ids of finished lines remembered, so a repeated final beat never plays twice. */
const FINISHED_LIMIT = 96;

const PHASES = new Set<PierFeedLine['phase']>(['float', 'bite', 'fight']);
const VIAS = new Set<PierFeedLine['via']>(['chat', 'pier']);
type GoneReason = Extract<PierFeedEvent, { kind: 'gone' }>['reason'];
const REASONS = new Set<GoneReason>(['escaped', 'snapped', 'missed', 'pulled', 'cleared', 'unkept']);

type Plain = Record<string, unknown>;
const plain = (value: unknown): value is Plain => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max;

function vec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  for (const part of value) if (typeof part !== 'number' || !Number.isFinite(part) || Math.abs(part) > COORD_LIMIT) return null;
  return [value[0] as number, value[1] as number, value[2] as number];
}

/** Drops control, bidirectional and zero-width characters, which could reorder or hide a broadcast's words. */
function printable(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e)
      || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff) continue;
    out += char;
  }
  return out;
}

function who(value: unknown): PierFeedWho | null {
  if (!plain(value)) return null;
  const { name, slot, colour } = value;
  let kept: string | null = null;
  if (name !== null) {
    if (typeof name !== 'string' || name.length > NAME_LIMIT) return null;
    // Control characters never reach a broadcast; an empty name reads as a hidden one.
    const clean = printable(name).trim();
    kept = clean || null;
  }
  if (slot !== null && !(typeof slot === 'number' && Number.isSafeInteger(slot) && slot >= 0)) return null;
  if (colour !== null && !(typeof colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(colour))) return null;
  return { name: kept, slot: slot as number | null, colour: colour === null ? null : (colour as string).toLowerCase() };
}

function line(value: unknown): PierFeedLine | null {
  if (!plain(value)) return null;
  const owner = who(value.who), float = vec3(value.float);
  if (!text(value.id, ID_LIMIT) || !owner || !float || !time(value.at)) return null;
  if (!VIAS.has(value.via as PierFeedLine['via']) || !PHASES.has(value.phase as PierFeedLine['phase'])) return null;
  return { id: value.id, who: owner, via: value.via as PierFeedLine['via'], phase: value.phase as PierFeedLine['phase'], float, at: value.at };
}

function fish(value: unknown): FishingCaughtFish | null {
  if (!plain(value) || !text(value.speciesId, SPECIES_LIMIT)) return null;
  const { lengthMm, weightG } = value;
  if (typeof lengthMm !== 'number' || !Number.isFinite(lengthMm) || lengthMm <= 0 || lengthMm > 100_000) return null;
  if (typeof weightG !== 'number' || !Number.isFinite(weightG) || weightG <= 0 || weightG > 10_000_000) return null;
  return { speciesId: value.speciesId, lengthMm, weightG };
}

/**
 * One pier event from untrusted JSON, rebuilt field by field (unknown fields are left behind), or null when any part
 * of it is not what the realm sends.
 */
export function parsePierFeedEvent(value: unknown): PierFeedEvent | null {
  if (!plain(value) || !time(value.at)) return null;
  const at = value.at;
  switch (value.kind) {
    case 'lines': {
      if (!Array.isArray(value.lines) || value.lines.length > LINES_LIMIT || !count(value.cap, LINES_LIMIT)) return null;
      const lines: PierFeedLine[] = [];
      for (const entry of value.lines) { const parsed = line(entry); if (!parsed) return null; lines.push(parsed); }
      return { kind: 'lines', at, lines, cap: value.cap };
    }
    case 'line': {
      const parsed = line(value.line);
      return parsed ? { kind: 'line', at, line: parsed } : null;
    }
    case 'caught': {
      const owner = who(value.who), caught = fish(value.fish);
      const float = value.float === null ? null : vec3(value.float);
      if (!text(value.id, ID_LIMIT) || !owner || !caught || !VIAS.has(value.via as PierFeedLine['via'])) return null;
      if (typeof value.kingdomFirst !== 'boolean' || (value.float !== null && !float)) return null;
      if (value.keepsake !== null && !count(value.keepsake, 1_000_000_000)) return null;
      return { kind: 'caught', at, id: value.id, who: owner, via: value.via as PierFeedLine['via'], fish: caught,
        kingdomFirst: value.kingdomFirst, keepsake: value.keepsake as number | null, float };
    }
    case 'broken': {
      const owner = who(value.who), float = vec3(value.float);
      if (!text(value.id, ID_LIMIT) || !owner || !float || !text(value.speciesId, SPECIES_LIMIT)) return null;
      return { kind: 'broken', at, id: value.id, who: owner, speciesId: value.speciesId, float };
    }
    case 'gone':
      if (!text(value.id, ID_LIMIT) || !REASONS.has(value.reason as GoneReason)) return null;
      return { kind: 'gone', at, id: value.id, reason: value.reason as GoneReason };
    case 'full': {
      const owner = who(value.who);
      if (!owner || !count(value.cap, LINES_LIMIT)) return null;
      return { kind: 'full', at, who: owner, cap: value.cap };
    }
    default: return null;
  }
}

/** What a view draws, in order. Every beat carries the line as it was last known, when there was one. */
export type PierFeedBeat =
  /** A float appeared (`previous` null) or changed: its phase, or its person's name or light. `quiet` when a snapshot brought it. */
  | { readonly kind: 'line'; readonly line: PierFeedLine; readonly previous: PierFeedLine | null; readonly quiet: boolean }
  | { readonly kind: 'caught'; readonly event: Extract<PierFeedEvent, { kind: 'caught' }>; readonly line: PierFeedLine | null }
  | { readonly kind: 'broken'; readonly event: Extract<PierFeedEvent, { kind: 'broken' }>; readonly line: PierFeedLine | null }
  /** The float leaves quietly. `quiet` when a fresh snapshot no longer had it. */
  | { readonly kind: 'gone'; readonly id: string; readonly reason: GoneReason; readonly line: PierFeedLine | null; readonly quiet: boolean }
  | { readonly kind: 'full'; readonly event: Extract<PierFeedEvent, { kind: 'full' }> };

export interface PierFeedState {
  /** Folds one parsed event in. Returns false when it changed nothing (a repeat, or a throttled full beat). */
  apply(event: PierFeedEvent): boolean;
  /** The chat lines in the water now, by id, in the order they were cast. */
  lines(): ReadonlyMap<string, PierFeedLine>;
  /** The realm's cap on chat lines, once a snapshot has said it. */
  cap(): number | null;
  /** The beats since the last drain, oldest first. */
  drain(): PierFeedBeat[];
}

const sameWho = (a: PierFeedWho, b: PierFeedWho) => a.name === b.name && a.slot === b.slot && a.colour === b.colour;
const sameLine = (a: PierFeedLine, b: PierFeedLine) => a.phase === b.phase && a.via === b.via && sameWho(a.who, b.who)
  && a.float[0] === b.float[0] && a.float[1] === b.float[1] && a.float[2] === b.float[2];

export function createPierFeedState(): PierFeedState {
  const current = new Map<string, PierFeedLine>();
  const finished = new Set<string>();
  let beats: PierFeedBeat[] = [];
  let cap: number | null = null, lastFull: number | null = null;
  const finish = (id: string) => {
    finished.add(id);
    if (finished.size > FINISHED_LIMIT) finished.delete(finished.values().next().value!);
  };
  const take = (id: string) => { const known = current.get(id) ?? null; current.delete(id); finish(id); return known; };
  const upsert = (next: PierFeedLine, quiet: boolean): boolean => {
    if (next.via !== 'chat' || finished.has(next.id)) return false;
    const previous = current.get(next.id) ?? null;
    if (previous && sameLine(previous, next)) return false;
    current.set(next.id, next);
    beats.push({ kind: 'line', line: next, previous, quiet });
    return true;
  };
  return {
    apply(event) {
      switch (event.kind) {
        case 'lines': {
          cap = event.cap;
          let changed = false;
          const fresh = new Set(event.lines.map(entry => entry.id));
          for (const [id, known] of [...current]) if (!fresh.has(id)) {
            current.delete(id);
            beats.push({ kind: 'gone', id, reason: 'cleared', line: known, quiet: true });
            changed = true;
          }
          // A snapshot is the truth: a line it still holds is not finished, whatever was heard before.
          for (const entry of event.lines) { finished.delete(entry.id); if (upsert(entry, true)) changed = true; }
          return changed;
        }
        case 'line': return upsert(event.line, false);
        case 'caught': {
          if (finished.has(event.id)) return false;
          beats.push({ kind: 'caught', event, line: take(event.id) });
          return true;
        }
        case 'broken': {
          if (finished.has(event.id)) return false;
          beats.push({ kind: 'broken', event, line: take(event.id) });
          return true;
        }
        case 'gone': {
          if (finished.has(event.id)) return false;
          const known = take(event.id);
          beats.push({ kind: 'gone', id: event.id, reason: event.reason, line: known, quiet: false });
          return true;
        }
        case 'full': {
          if (lastFull !== null && event.at - lastFull < PIER_FULL_GAP_MS && event.at >= lastFull) return false;
          lastFull = event.at;
          beats.push({ kind: 'full', event });
          return true;
        }
      }
    },
    lines: () => current,
    cap: () => cap,
    drain() { const out = beats; beats = []; return out; },
  };
}

/** The parts of the browser's EventSource the watcher uses, so a test can hand in its own. */
export interface PierEventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: { readonly data?: unknown }) => void): void;
  removeEventListener(type: string, listener: (event: { readonly data?: unknown }) => void): void;
  close(): void;
}
export type PierEventSourceFactory = (url: string) => PierEventSourceLike;

export interface PierWatchOptions {
  /** Prefix for the route, e.g. an origin; same origin when left out. */
  readonly base?: string;
  readonly eventSource?: PierEventSourceFactory;
  /** 0..1, for the reconnect jitter. */
  readonly random?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
  /** 'open' once events flow; 'waiting' while a reconnect is scheduled, with its delay. */
  readonly onStatus?: (status: 'connecting' | 'open' | 'waiting', retryMs?: number) => void;
}
export interface PierWatch { dispose(): void }

export const PIER_RETRY_MIN_MS = 1_000, PIER_RETRY_MAX_MS = 30_000;
/** The wait before reconnect attempt `attempt` (0 first): doubling from one second to thirty, jittered by a quarter either way. */
export function pierRetryDelay(attempt: number, random: number): number {
  const base = Math.min(PIER_RETRY_MAX_MS, PIER_RETRY_MIN_MS * 2 ** Math.max(0, Math.min(16, Math.floor(attempt))));
  const jitter = .75 + .5 * Math.min(1, Math.max(0, Number.isFinite(random) ? random : .5));
  return Math.round(Math.min(PIER_RETRY_MAX_MS, Math.max(PIER_RETRY_MIN_MS * .75, base * jitter)));
}

export function pierWatchUrl(kingdomId: string, base = ''): string {
  const id = KingdomIdSchema.safeParse(kingdomId);
  if (!id.success) throw new Error('Choose a valid kingdom to watch the pier of.');
  return `${base.replace(/\/+$/, '')}${PIER_WATCH_ROUTE.replace(':kingdomId', encodeURIComponent(id.data))}`;
}

/**
 * Watches a kingdom's pier: every well-formed `pier` event goes to `onEvent`, the first of each connection being the
 * snapshot of lines. A dropped stream is closed and reopened after a jittered, doubling wait (1 s up to 30 s); the
 * wait resets once a connection delivers an event. `dispose` stops it for good.
 */
export function watchPierFeed(kingdomId: string, onEvent: (event: PierFeedEvent) => void, options: PierWatchOptions = {}): PierWatch {
  const url = pierWatchUrl(kingdomId, options.base);
  const open: PierEventSourceFactory = options.eventSource ?? (target => {
    if (typeof EventSource !== 'function') throw new Error('This browser cannot watch the pier.');
    return new EventSource(target) as unknown as PierEventSourceLike;
  });
  const random = options.random ?? Math.random;
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let source: PierEventSourceLike | null = null, timer: unknown = null, attempt = 0, disposed = false, flowing = false;
  const status = (value: 'connecting' | 'open' | 'waiting', retryMs?: number) => {
    try { options.onStatus?.(value, retryMs); } catch (error) { console.error('A pier watch status listener failed.', error); }
  };
  const onMessage = (message: { readonly data?: unknown }) => {
    if (disposed || typeof message.data !== 'string' || message.data.length > 64 * 1024) return;
    let raw: unknown;
    try { raw = JSON.parse(message.data); } catch { return; }
    const event = parsePierFeedEvent(raw);
    if (!event) return;
    // A fresh connection is trusted once it says what the pier holds; only then does the wait reset.
    if (!flowing) { if (event.kind !== 'lines') return; flowing = true; attempt = 0; status('open'); }
    try { onEvent(event); } catch (error) { console.error('A pier beat could not be shown.', error); }
  };
  const close = () => {
    if (!source) return;
    source.removeEventListener('pier', onMessage); source.removeEventListener('error', onError);
    try { source.close(); } catch { /* Already closed. */ }
    source = null;
  };
  function onError() {
    if (disposed) return;
    close();
    schedule();
  }
  const schedule = () => {
    if (disposed || timer !== null) return;
    const wait = pierRetryDelay(attempt, random());
    attempt += 1;
    status('waiting', wait);
    timer = setTimer(() => { timer = null; connect(); }, wait);
  };
  function connect() {
    if (disposed) return;
    flowing = false;
    status('connecting');
    try { source = open(url); }
    catch { source = null; schedule(); return; }
    source.addEventListener('pier', onMessage);
    source.addEventListener('error', onError);
  }
  connect();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
      close();
    },
  };
}
