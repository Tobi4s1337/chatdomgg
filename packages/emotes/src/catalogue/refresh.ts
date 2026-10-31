import type { KingdomId } from '../deps';
import { EmoteDecodeError } from '../decode/errors';
import { EMOTE_SOURCE_LIMITS } from '../profiles';
import { sha256Hex } from '../sha256';
import type { EmoteImageDecoder, EmoteProvider, EmoteRendition } from '../types';
import type { EmoteBlobStore } from './blobs';
import { checkAssetUrl } from './policy';
import { unavailable } from './twitch';
import { EmoteTransportError, type AuthorizedEmoteTransport, type EmoteCatalogueAdapter, type EmoteCatalogueEntry, type EmoteTransportFailure, type SkippedCatalogueEntry } from './types';

export type ThirdPartyProvider = Exclude<EmoteProvider, 'twitch'>;
export const THIRD_PARTY_PROVIDERS: readonly ThirdPartyProvider[] = ['7tv', 'bttv', 'ffz'];
export type EmoteRefreshReason = 'genesis' | 'go-live' | 'daily';

/** What one source looked like at its last trustworthy check. Serializable; no bytes inside. */
export interface EmoteSourceRecord extends EmoteCatalogueEntry {
  state: 'ready' | 'unavailable';
  /** SHA-256 of the last verified bytes; null when they were never fetched and decoded. */
  sourceHash: string | null;
  decoded: { width: number; height: number; frames: number; periodMs: number } | null;
  /** Private explanation for the monarch's plaque; never shown on stream. */
  problem: { code: string; message: string } | null;
  firstSeenAt: number;
  changedAt: number;
  checkedAt: number;
}

/**
 * - `current`: the provider answered on this refresh.
 * - `stale`: it failed this time; the last successful entries are kept, unchanged.
 * - `unavailable`: it has never answered for this kingdom, so nothing is known.
 * - `disabled`: a third-party provider the monarch has not opted in; it was not contacted.
 */
export type ProviderHealth = 'current' | 'stale' | 'unavailable' | 'disabled';

export interface ProviderCatalogueState {
  provider: EmoteProvider;
  health: ProviderHealth;
  lastSuccessAt: number | null;
  attemptedAt: number | null;
  problem: { reason: EmoteTransportFailure | 'malformed'; message: string } | null;
  truncated: boolean;
  skipped: SkippedCatalogueEntry[];
  entries: EmoteSourceRecord[];
}

export interface EmoteCatalogueSnapshot {
  version: 1;
  kingdomId: KingdomId;
  channelId: string;
  /** Increments whenever a refresh changes anything a consumer could see. */
  revision: number;
  refreshedAt: number;
  reason: EmoteRefreshReason;
  providers: Partial<Record<EmoteProvider, ProviderCatalogueState>>;
}

/** Keys by provider-qualified emote ID. */
export interface EmoteCatalogueChanges {
  /** New to the catalogue and decoded. */
  added: string[];
  /** Same provider ID, different source bytes: every approval bound to the old hash is void. */
  changed: string[];
  /** Same bytes, new code. */
  renamed: string[];
  /** The provider answered and no longer lists it: withdraw it quietly. */
  removed: string[];
  /** The monarch switched the provider off: withdraw without calling it removed. */
  withdrawn: string[];
  /** Listed, but its bytes could not be fetched or decoded; kept private with the reason. */
  unavailable: string[];
}

export interface EmoteRefreshInput {
  kingdomId: KingdomId;
  /** The broadcaster's Twitch user ID, from the kingdom's authoritative record. */
  channelId: string;
  reason: EmoteRefreshReason;
  atMs: number;
  /** The monarch's stored opt-ins. A disabled provider is never contacted. */
  thirdParty: Readonly<Record<ThirdPartyProvider, boolean>>;
  previous: EmoteCatalogueSnapshot | null;
}

export interface EmoteRefreshResult {
  snapshot: EmoteCatalogueSnapshot;
  changes: EmoteCatalogueChanges;
  /** Network calls made, for budgeting and for proving that disabled means none. */
  requests: { catalogues: number; assets: number };
}

export interface EmoteRefresherPorts {
  transport: AuthorizedEmoteTransport;
  decoder: EmoteImageDecoder;
  blobs: EmoteBlobStore;
  adapters: readonly EmoteCatalogueAdapter[];
  /** A signal that fires after `ms`; injectable for tests. Defaults to `AbortSignal.timeout`. */
  deadline?: (ms: number) => AbortSignal;
}

/** At most `limit` jobs at once per kingdom; the queue is FIFO. Shared by fetch, decode and compile jobs. */
export function createKingdomJobLimiter(limit: number = EMOTE_SOURCE_LIMITS.concurrentJobsPerKingdom) {
  const lanes = new Map<string, { running: number; queue: (() => void)[] }>();
  return {
    async run<T>(kingdomId: string, job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      let lane = lanes.get(kingdomId);
      if (!lane) { lane = { running: 0, queue: [] }; lanes.set(kingdomId, lane); }
      const current = lane;
      if (current.running >= limit) {
        await new Promise<void>((resolve, reject) => {
          const start = () => { signal?.removeEventListener('abort', cancel); resolve(); };
          const cancel = () => { current.queue.splice(current.queue.indexOf(start), 1); reject(signal!.reason); };
          current.queue.push(start);
          signal?.addEventListener('abort', cancel, { once: true });
        });
      }
      current.running++;
      try { return await job(); } finally {
        current.running--;
        const next = current.queue.shift();
        if (next) next(); else if (!current.running) lanes.delete(kingdomId);
      }
    },
    active(kingdomId: string): number { return lanes.get(kingdomId)?.running ?? 0; },
  };
}

const emptyChanges = (): EmoteCatalogueChanges => ({ added: [], changed: [], renamed: [], removed: [], withdrawn: [], unavailable: [] });

function transportProblem(error: unknown): { code: string; message: string } {
  if (error instanceof EmoteTransportError) return { code: error.kind, message: error.message };
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return { code: 'timeout', message: 'The image did not arrive in time.' };
  return { code: 'network', message: 'The image could not be fetched.' };
}

/**
 * Reads every provider the kingdom allows, fetches and hashes every listed image, decodes what is
 * new or changed, and reconciles against the previous snapshot:
 * - an outage keeps the last successful entries (stale), never empties the catalogue;
 * - an observed empty answer removes everything that provider listed;
 * - identity is the provider ID plus the hash of the fetched bytes, never the display name;
 * - a disabled third-party provider is not contacted at all and its entries are withdrawn.
 * Overlapping refreshes for one kingdom share one run. The caller persists the snapshot (CAS)
 * before exposing anything built from it.
 */
export function createEmoteCatalogueRefresher(ports: EmoteRefresherPorts) {
  const limiter = createKingdomJobLimiter();
  const inflight = new Map<string, Promise<EmoteRefreshResult>>();
  const deadline = ports.deadline ?? ((ms: number) => AbortSignal.timeout(ms));
  const adapters = new Map(ports.adapters.map(adapter => [adapter.provider, adapter]));
  const bounded = (signal: AbortSignal): AbortSignal => AbortSignal.any([signal, deadline(EMOTE_SOURCE_LIMITS.networkMs)]);

  async function run(input: EmoteRefreshInput, signal: AbortSignal): Promise<EmoteRefreshResult> {
    const { previous, atMs } = input, changes = emptyChanges(), requests = { catalogues: 0, assets: 0 };
    const providers: EmoteCatalogueSnapshot['providers'] = {};
    let visible = previous?.channelId !== input.channelId || !previous;
    for (const provider of ['twitch', ...THIRD_PARTY_PROVIDERS] as const) {
      signal.throwIfAborted();
      const before = previous?.providers[provider];
      if (provider !== 'twitch' && !input.thirdParty[provider]) {
        for (const entry of before?.entries ?? []) changes.withdrawn.push(entry.id);
        providers[provider] = { provider, health: 'disabled', lastSuccessAt: null, attemptedAt: null, problem: null, truncated: false, skipped: [], entries: [] };
        if (before && before.health !== 'disabled') visible = true;
        continue;
      }
      const adapter = adapters.get(provider);
      requests.catalogues += adapter ? 1 : 0;
      const result = adapter
        ? await adapter.fetchCatalogue({ kingdomId: input.kingdomId, channelId: input.channelId }, bounded(signal)).catch(error => unavailable(provider, error))
        : { status: 'unavailable' as const, provider, reason: 'unavailable' as const, message: 'No adapter is bound for this provider.' };
      signal.throwIfAborted();
      if (result.status === 'unavailable') {
        const known = before && before.lastSuccessAt !== null;
        providers[provider] = {
          provider, health: known ? 'stale' : 'unavailable', lastSuccessAt: before?.lastSuccessAt ?? null, attemptedAt: atMs,
          problem: { reason: result.reason, message: result.message }, truncated: before?.truncated ?? false, skipped: before?.skipped ?? [],
          entries: known ? before.entries : [],
        };
        if (before?.health !== providers[provider]!.health) visible = true;
        continue;
      }
      const prior = new Map((before?.entries ?? []).map(entry => [entry.id, entry]));
      const records = await Promise.all(result.entries.map(entry => limiter.run(input.kingdomId, () => reconcile(entry, prior.get(entry.id) ?? null, atMs, signal, changes, requests), signal)));
      const listed = new Set(result.entries.map(entry => entry.id));
      for (const id of prior.keys()) if (!listed.has(id)) changes.removed.push(id);
      providers[provider] = { provider, health: 'current', lastSuccessAt: atMs, attemptedAt: atMs, problem: null, truncated: result.truncated, skipped: result.skipped.slice(0, 64), entries: records };
      if (before?.health !== 'current') visible = true;
    }
    if (Object.values(changes).some(list => list.length)) visible = true;
    const snapshot: EmoteCatalogueSnapshot = {
      version: 1, kingdomId: input.kingdomId, channelId: input.channelId, revision: (previous?.revision ?? 0) + (visible ? 1 : 0),
      refreshedAt: atMs, reason: input.reason, providers,
    };
    return { snapshot, changes, requests };
  }

  async function reconcile(entry: EmoteCatalogueEntry, prior: EmoteSourceRecord | null, atMs: number, signal: AbortSignal,
    changes: EmoteCatalogueChanges, requests: { assets: number }): Promise<EmoteSourceRecord> {
    const base = { ...entry, firstSeenAt: prior?.firstSeenAt ?? atMs, checkedAt: atMs };
    const fail = (code: string, message: string, keepPrior: boolean): EmoteSourceRecord => {
      // An outage while fetching a known image keeps what was verified before; anything else is private and unavailable.
      if (keepPrior && prior && prior.asset === entry.asset) return { ...prior, ...entry, state: prior.state, sourceHash: prior.sourceHash, decoded: prior.decoded, problem: prior.problem, firstSeenAt: prior.firstSeenAt, changedAt: prior.changedAt, checkedAt: prior.checkedAt };
      changes.unavailable.push(entry.id);
      return { ...base, state: 'unavailable', sourceHash: null, decoded: null, problem: { code, message }, changedAt: prior?.state === 'unavailable' ? prior.changedAt : atMs };
    };
    const checked = checkAssetUrl(entry.provider, entry.asset);
    if (!checked.ok) return fail('policy', `The image address ${checked.reason}.`, false);
    let bytes: Uint8Array;
    try {
      requests.assets++;
      bytes = await ports.transport.getAsset(entry.provider, checked.url.href, bounded(signal));
    } catch (error) {
      signal.throwIfAborted();
      const problem = transportProblem(error);
      return fail(problem.code, problem.message, problem.code !== 'policy' && problem.code !== 'too-large' && problem.code !== 'not-found');
    }
    if (!(bytes instanceof Uint8Array)) return fail('network', 'The image arrived in an unexpected form.', true);
    if (bytes.length > EMOTE_SOURCE_LIMITS.compressedBytes) return fail('too-large', 'The image is larger than 4 MiB.', false);
    const sourceHash = sha256Hex(bytes);
    if (prior?.state === 'ready' && prior.sourceHash === sourceHash) {
      await ports.blobs.put(sourceHash, bytes);
      if (prior.name !== entry.name) changes.renamed.push(entry.id);
      return { ...base, state: 'ready', sourceHash, decoded: prior.decoded, problem: null, changedAt: prior.name !== entry.name ? atMs : prior.changedAt };
    }
    let decoded;
    try {
      decoded = await ports.decoder.decode(bytes, entry.rendition as EmoteRendition, signal);
    } catch (error) {
      signal.throwIfAborted();
      const code = error instanceof EmoteDecodeError ? error.code : 'corrupt';
      return fail(code, error instanceof EmoteDecodeError ? error.message : 'The image could not be decoded.', false);
    }
    if (entry.animated && decoded.frames.length < 2) {
      // The provider promised an animation; a lone frame would silently turn it into its poster.
      return fail('unsupported', 'The provider marks this emote animated, but its image has a single frame.', false);
    }
    await ports.blobs.put(sourceHash, bytes);
    if (prior?.state === 'ready') changes.changed.push(entry.id);
    else changes.added.push(entry.id);
    return {
      ...base, state: 'ready', sourceHash, problem: null, changedAt: atMs,
      decoded: { width: decoded.width, height: decoded.height, frames: decoded.frames.length, periodMs: decoded.frames.length > 1 ? decoded.frames.reduce((sum, f) => sum + f.durationMs, 0) : 0 },
    };
  }

  return {
    /** Overlapping calls for the same kingdom share the run already in flight. */
    refresh(input: EmoteRefreshInput, signal: AbortSignal): Promise<EmoteRefreshResult> {
      const running = inflight.get(input.kingdomId);
      if (running) return running;
      const job = run(input, signal).finally(() => inflight.delete(input.kingdomId));
      inflight.set(input.kingdomId, job);
      return job;
    },
    activeJobs: (kingdomId: string) => limiter.active(kingdomId),
  };
}

/** The catalogue-wide health a view reports: Twitch decides availability, any stale provider makes it stale. */
export function catalogueHealth(snapshot: EmoteCatalogueSnapshot | null): 'current' | 'stale' | 'unavailable' {
  const twitch = snapshot?.providers.twitch;
  if (!twitch || twitch.health === 'unavailable') return 'unavailable';
  return Object.values(snapshot.providers).some(state => state?.health === 'stale') ? 'stale' : 'current';
}
