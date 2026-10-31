import { KingdomIdSchema, Sha256Schema, TokenSchema, type KingdomId, type MaterialRegistry, type PersonId } from '../deps';
import { compileEmote } from '../compile';
import { EMOTE_COMPILER_VERSION } from '../profiles';
import { sha256Hex, sha256Text } from '../sha256';
import type {
  ApprovedEmoteVisual, CompiledEmote, EmoteCatalogueView, EmoteImageDecoder, EmoteOrigin, EmotePurpose, EmoteReveal, EmoteSource, InlineEmoteVisual,
} from '../types';
import { verifyEmoteBlobStore, type EmoteBlobStore } from './blobs';
import { decodeCompiledEmote, encodeCompiledEmote } from './compiled-codec';
import { renderContactSheets } from './contact-sheet';
import { catalogueHealth, createEmoteCatalogueRefresher, createKingdomJobLimiter, THIRD_PARTY_PROVIDERS, type EmoteCatalogueChanges, type EmoteRefreshReason, type EmoteRefreshResult, type EmoteSourceRecord, type ThirdPartyProvider } from './refresh';
import { emptyEmoteState, type EmoteCandidateRecord, type EmoteRepository, type EmoteRetireReason, type EmoteStoredState } from './repository';
import { emptyEmoteRefreshSchedule, planEmoteRefresh, refreshLeftGaps, type EmoteRefreshPlan } from './schedule';
import { createThirdPartyEmoteAdapter } from './third-party';
import { createTwitchEmoteAdapter } from './twitch';
import type { AuthorizedEmoteTransport, EmoteCatalogueAdapter } from './types';

/** The Spec 24 review port: Luna reviews the carved object; flat use of a third-party image is a separate receipt. */
export interface EmoteReviewPort {
  review(input: { candidate: CompiledEmote; contactSheets: readonly Uint8Array[]; requestId: string }, signal: AbortSignal): Promise<{
    decision: 'approve' | 'hold' | 'refuse' | 'cold'; reviewedGeometryHash: string; receiptId: string;
  }>;
  reviewFlat(input: { source: EmoteSource; contactSheets: readonly Uint8Array[]; requestId: string }, signal: AbortSignal): Promise<{
    decision: 'approve' | 'hold' | 'refuse' | 'cold'; reviewedSourceHash: string; receiptId: string;
  }>;
}

/** Resolved by the server from its own session. A client-supplied actor is never trusted. Throws when the session is not the monarch. */
export interface EmoteAuthority {
  requireMonarch(session: unknown, kingdomId: KingdomId): Promise<PersonId>;
}

/** Facts from the kingdom's authoritative record. */
export interface EmoteKingdomPort {
  /** The broadcaster's Twitch user ID, or null when the kingdom has no bound channel. */
  channelId(kingdomId: KingdomId): Promise<string | null>;
  /** The kingdom's explicit sculpting palette: a subset of the real registry, and its revision. */
  palette(kingdomId: KingdomId): Promise<{ allowedMaterialIds: readonly number[]; paletteRevision: number }>;
}

export interface EmoteCatalogueServicePorts {
  /** `simulated` for rehearsals and benches; every source, candidate and reveal carries it. */
  origin: EmoteOrigin;
  repository: EmoteRepository;
  blobs: EmoteBlobStore;
  transport: AuthorizedEmoteTransport;
  decoder: EmoteImageDecoder;
  review: EmoteReviewPort;
  authority: EmoteAuthority;
  kingdom: EmoteKingdomPort;
  registry: MaterialRegistry;
  /** Defaults to Twitch plus the three opt-in providers over `transport`. */
  adapters?: readonly EmoteCatalogueAdapter[];
  deadline?: (ms: number) => AbortSignal;
}

export type EmoteServiceFailureCode = 'unavailable' | 'stale' | 'forbidden' | 'not-found' | 'invalid';
export type EmoteServiceFailure = { status: 'failed'; code: EmoteServiceFailureCode; message: string };
export type EmoteMutationResult = { status: 'applied'; revision: number } | EmoteServiceFailure;

/** What the monarch's private plaque sees. Never shown on stream. */
export interface EmotePrivateCatalogue {
  status: 'ok';
  kingdomId: KingdomId;
  revision: number;
  health: 'current' | 'stale' | 'unavailable';
  providers: Record<ThirdPartyProvider, boolean>;
  sources: { id: string; provider: string; name: string; animated: boolean; state: EmoteSourceRecord['state']; sourceHash: string | null; frames: number | null; problem: string | null }[];
  candidates: { id: string; purpose: EmotePurpose; revision: string; state: EmoteCandidateRecord['state']; frames: number; periodMs: number; geometryHash: string; retired: EmoteRetireReason | null }[];
  pendingReveals: number;
  stream: EmoteStoredState['stream'];
}

/** The server facts shape Genesis takes for approved emotes (`ChannelGenesisFacts.approvedEmotes`). */
export interface EmoteGenesisFact {
  emoteId: string;
  broadcasterId: KingdomId;
  asset: { assetHash: string; approvalId: string };
  allowedUses: ('statue' | 'weathervane' | 'stained-glass')[];
}

/**
 * One carving standing in public: what a scene host places. Carries no reason, review or source
 * detail, so a withdrawal looks the same whether the source changed, left or was switched off.
 */
export interface EmotePlacement {
  id: string;
  purpose: EmotePurpose;
  revision: string;
  origin: EmoteOrigin;
}

/** What a host changes in its world between two placement lists (see `diffEmotePlacements`). */
export interface EmotePlacementChanges {
  raise: EmotePlacement[];
  /** Same emote and purpose, a newer carving: swap it in place, keeping the placement. */
  replace: { from: EmotePlacement; to: EmotePlacement }[];
  /** Withdraw quietly: no spectacle, no edit to anyone's home; the host's own hiding policy applies. */
  withdraw: EmotePlacement[];
}

/** Pure: the host keeps the list it placed and asks what changed after every catalogue revision. */
export function diffEmotePlacements(before: readonly EmotePlacement[], after: readonly EmotePlacement[]): EmotePlacementChanges {
  const key = (p: EmotePlacement) => `${p.id}|${p.purpose}`;
  const old = new Map(before.map(p => [key(p), p])), next = new Map(after.map(p => [key(p), p]));
  const changes: EmotePlacementChanges = { raise: [], replace: [], withdraw: [] };
  for (const [k, placement] of next) {
    const was = old.get(k);
    if (!was) changes.raise.push(placement);
    else if (was.revision !== placement.revision) changes.replace.push({ from: was, to: placement });
  }
  for (const [k, placement] of old) if (!next.has(k)) changes.withdraw.push(placement);
  return changes;
}

const fail = (code: EmoteServiceFailureCode, message: string): EmoteServiceFailure => ({ status: 'failed', code, message });
const PURPOSES = new Set<EmotePurpose>(['statue', 'heraldry', 'motif', 'effect']);
const REASONS = new Set<EmoteRefreshReason>(['genesis', 'go-live', 'daily', 'opt-in']);
const DECISIONS = new Set(['approve', 'hold', 'refuse', 'cold']);
const MAX_RETIRED = 256, MAX_REVEALS = 256, CAS_ATTEMPTS = 4;
const INLINE_LIMITS = { entries: 256, bytes: 16 * 1024 * 1024 };
const VISUAL_LIMITS = { entries: 64, bytes: 96 * 1024 * 1024 };

/** A bounded cache by entry count and bytes; least recently used leaves first. */
function boundedCache<V>(limits: { entries: number; bytes: number }) {
  const map = new Map<string, { value: V; bytes: number }>();
  let bytes = 0;
  return {
    get(key: string): V | undefined {
      const hit = map.get(key);
      if (!hit) return undefined;
      map.delete(key); map.set(key, hit);
      return hit.value;
    },
    set(key: string, value: V, size: number): void {
      if (size > limits.bytes) return;
      const old = map.get(key);
      if (old) { bytes -= old.bytes; map.delete(key); }
      map.set(key, { value, bytes: size }); bytes += size;
      for (const [k, entry] of map) {
        if (bytes <= limits.bytes && map.size <= limits.entries) break;
        map.delete(k); bytes -= entry.bytes;
      }
    },
    get size() { return map.size; },
    get bytes() { return bytes; },
  };
}

function sourceRecords(state: EmoteStoredState): Map<string, EmoteSourceRecord> {
  const records = new Map<string, EmoteSourceRecord>();
  for (const provider of ['twitch', ...THIRD_PARTY_PROVIDERS] as const) {
    if (provider !== 'twitch' && !state.providers[provider]) continue;
    for (const entry of state.snapshot?.providers[provider]?.entries ?? []) records.set(entry.id, entry);
  }
  return records;
}

/**
 * Why a candidate can no longer stand, or null while its approval binding still holds. An outage
 * keeps the provider's last entries, so a known safe asset survives it; only an observed removal,
 * a changed source, a switched-off provider, a new palette or a new compiler retires it.
 */
function invalidation(state: EmoteStoredState, candidate: EmoteCandidateRecord, paletteRevision: number | null, records = sourceRecords(state)): EmoteRetireReason | null {
  const record = records.get(candidate.id);
  if (!record) {
    const provider = candidate.id.split('.')[0]!;
    return provider !== 'twitch' && !state.providers[provider as ThirdPartyProvider] ? 'provider-withdrawn' : 'source-removed';
  }
  if (record.state !== 'ready' || record.sourceHash === null) return 'source-removed';
  if (record.sourceHash !== candidate.sourceHash) return 'source-changed';
  if (candidate.compilerVersion !== EMOTE_COMPILER_VERSION) return 'compiler-changed';
  if (paletteRevision !== null && candidate.paletteRevision !== paletteRevision) return 'palette-changed';
  return null;
}

/** Retires every live candidate whose binding broke, drops stale selections and bounds the tombstones. */
function reconcile(state: EmoteStoredState, paletteRevision: number | null, atMs: number): void {
  const records = sourceRecords(state);
  for (const candidate of state.candidates) {
    if (candidate.state === 'retired') continue;
    const reason = invalidation(state, candidate, paletteRevision, records);
    if (reason) { candidate.state = 'retired'; candidate.retired = { reason, at: atMs }; }
  }
  state.selections = state.selections.filter(selection => records.get(selection.id)?.sourceHash === selection.sourceHash);
  withdrawRetiredReveals(state, atMs);
  const retired = state.candidates.filter(c => c.state === 'retired');
  if (retired.length > MAX_RETIRED) {
    const drop = new Set(retired.sort((a, b) => a.retired!.at - b.retired!.at).slice(0, retired.length - MAX_RETIRED));
    state.candidates = state.candidates.filter(c => !drop.has(c));
  }
}

/** A reveal whose carving retired before the host acknowledged it is never replayed. */
function withdrawRetiredReveals(state: EmoteStoredState, atMs: number): void {
  for (const record of state.reveals) {
    if (record.acknowledgedAt !== null || record.withdrawnAt) continue;
    const candidate = state.candidates.find(c => c.id === record.reveal.emoteId && c.revision === record.reveal.revision && c.purpose === 'statue');
    if (!candidate || candidate.state === 'retired') record.withdrawnAt = atMs;
  }
}

const isPending = (record: EmoteStoredState['reveals'][number]): boolean => record.acknowledgedAt === null && !record.withdrawnAt;

const revealId = (kingdomId: string, candidate: EmoteCandidateRecord, epoch: string): string =>
  `reveal.${sha256Text(`${kingdomId}|${candidate.id}|${candidate.revision}|${epoch}`).slice(0, 32)}`;

/**
 * Publishes every confirmed candidate in this live epoch. An older published revision of the same
 * emote and purpose retires as `replaced`. Statues get a replayable reveal; heraldry is raised quietly
 * with them. Idempotent: an already published candidate gets no second reveal.
 */
function publishConfirmed(state: EmoteStoredState, origin: EmoteOrigin, atMs: number): void {
  const epoch = state.stream?.live ? state.stream.epoch : null;
  if (!epoch) return;
  for (const candidate of state.candidates) {
    if (candidate.state !== 'confirmed') continue;
    for (const older of state.candidates) {
      if (older !== candidate && older.state === 'published' && older.id === candidate.id && older.purpose === candidate.purpose) {
        older.state = 'retired'; older.retired = { reason: 'replaced', at: atMs };
      }
    }
    const id = revealId(state.kingdomId, candidate, epoch);
    candidate.state = 'published';
    candidate.published = { epoch, at: atMs, revealId: id };
    if (candidate.purpose === 'statue' && !state.reveals.some(r => r.reveal.id === id)) {
      state.reveals.push({ reveal: { id, kingdomId: state.kingdomId, emoteId: candidate.id, revision: candidate.revision, streamEpoch: epoch, origin }, createdAt: atMs, acknowledgedAt: null });
    }
  }
  withdrawRetiredReveals(state, atMs);
  if (state.reveals.length > MAX_REVEALS) {
    // Only acknowledged or withdrawn reveals are ever dropped; a pending one is never lost.
    const acknowledged = state.reveals.filter(r => !isPending(r));
    const excess = new Set(acknowledged.slice(0, state.reveals.length - MAX_REVEALS));
    state.reveals = state.reveals.filter(r => !excess.has(r));
  }
}

/**
 * The emote catalogue service (Spec 24). It owns parsing, scheduling, reconciliation, hashes,
 * approval transitions and the public and private projections. Every mutation commits through the
 * repository's compare-and-swap before it reports success; a conflict reloads and re-evaluates.
 *
 * Lifecycle of one statue: `refresh` reads the channel → the monarch `selectCandidate`s a source by
 * the hash they saw → the server worker `prepareCandidate`s (decode, carve in the kingdom palette,
 * store) → `reviewCandidate` sends every frame's contact sheet to Luna → the monarch `confirmStatue`s
 * that exact geometry → the next authoritative live `onStreamState` publishes it with a replayable
 * reveal → the host acknowledges after its world commit. Approval binds source hash, geometry hash,
 * compiler, palette revision, purpose and scale; any change retires it quietly.
 */
export function createEmoteCatalogueService(bound: EmoteCatalogueServicePorts) {
  // Every content address is checked here, whatever the bound store does.
  const ports: EmoteCatalogueServicePorts = { ...bound, blobs: verifyEmoteBlobStore(bound.blobs) };
  const adapters = ports.adapters ?? [createTwitchEmoteAdapter(ports.transport), ...THIRD_PARTY_PROVIDERS.map(p => createThirdPartyEmoteAdapter(p, ports.transport))];
  const refresher = createEmoteCatalogueRefresher({ transport: ports.transport, decoder: ports.decoder, blobs: ports.blobs, adapters, ...(ports.deadline ? { deadline: ports.deadline } : {}) });
  const jobs = createKingdomJobLimiter();
  const visuals = boundedCache<ApprovedEmoteVisual>(VISUAL_LIMITS);
  const inline = boundedCache<Uint8Array>(INLINE_LIMITS);

  const checkKingdom = (kingdomId: unknown): kingdomId is KingdomId => KingdomIdSchema.safeParse(kingdomId).success;

  async function load(kingdomId: KingdomId): Promise<EmoteStoredState | EmoteServiceFailure> {
    try { return (await ports.repository.load(kingdomId)) ?? emptyEmoteState(kingdomId); } catch { return fail('unavailable', 'The emote catalogue could not be read.'); }
  }

  /** Load → change a copy → CAS, retried on conflict. `change` returns a failure, 'unchanged', or nothing to commit. */
  async function mutate(kingdomId: KingdomId, change: (draft: EmoteStoredState) => EmoteServiceFailure | 'unchanged' | void | Promise<EmoteServiceFailure | 'unchanged' | void>): Promise<EmoteMutationResult> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const state = await load(kingdomId);
      if ('status' in state) return state;
      const draft = structuredClone(state);
      const outcome = await change(draft);
      if (outcome === 'unchanged') return { status: 'applied', revision: state.revision };
      if (outcome) return outcome;
      draft.revision = state.revision + 1;
      try {
        if (await ports.repository.compareAndSwap(kingdomId, state.revision, draft)) return { status: 'applied', revision: draft.revision };
      } catch { return fail('unavailable', 'The emote catalogue could not be saved.'); }
    }
    return fail('stale', 'The catalogue kept changing underneath this request; try again.');
  }

  async function monarch(session: unknown, kingdomId: KingdomId): Promise<PersonId | EmoteServiceFailure> {
    try { return await ports.authority.requireMonarch(session, kingdomId); } catch { return fail('forbidden', 'Only the monarch can do this.'); }
  }

  /** A read that failed outright still counts toward the retry backoff, so the host never hammers. */
  async function recordFailedRead(kingdomId: KingdomId, atMs: number): Promise<void> {
    await mutate(kingdomId, draft => {
      const schedule = draft.schedule ?? emptyEmoteRefreshSchedule();
      draft.schedule = { ...schedule, failures: schedule.failures + 1, lastAttemptAt: atMs };
    }).catch(() => undefined);
  }

  async function palette(kingdomId: KingdomId): Promise<{ allowedMaterialIds: readonly number[]; paletteRevision: number } | null> {
    try { return await ports.kingdom.palette(kingdomId); } catch { return null; }
  }

  function findCandidate(state: EmoteStoredState, id: string, purpose: EmotePurpose, revision: string): EmoteCandidateRecord | undefined {
    return state.candidates.find(c => c.id === id && c.purpose === purpose && c.revision === revision);
  }

  async function loadVisual(candidate: EmoteCandidateRecord): Promise<ApprovedEmoteVisual | null> {
    const cached = visuals.get(candidate.blobHash);
    if (cached) return cached;
    const bytes = await ports.blobs.get(candidate.blobHash).catch(() => null);
    const compiled = bytes ? decodeCompiledEmote(bytes) : null;
    if (!compiled || compiled.revision !== candidate.revision || compiled.geometryHash !== candidate.geometryHash || compiled.sourceHash !== candidate.sourceHash || compiled.id !== candidate.id || compiled.purpose !== candidate.purpose) return null;
    const visual: ApprovedEmoteVisual = { id: compiled.id, revision: compiled.revision, origin: compiled.origin, purpose: compiled.purpose, frames: compiled.frames, periodMs: compiled.periodMs, mask: compiled.mask };
    visuals.set(candidate.blobHash, visual, bytes!.length);
    return visual;
  }

  const service = {
    /**
     * Reads every allowed provider and reconciles. `reason` is the host's schedule: Genesis, go-live,
     * the daily check or a provider the monarch just switched on (`tick` picks it for the host).
     * The commit re-checks what may have moved while the network was busy: a newer stored read wins,
     * a changed channel throws this read away, a provider switched off meanwhile stays withdrawn and
     * one switched on is read again soon. The result's `changes` are exactly what was committed.
     */
    async refresh(input: { kingdomId: KingdomId; reason: EmoteRefreshReason; atMs: number }, signal: AbortSignal): Promise<EmoteMutationResult & { changes?: EmoteCatalogueChanges }> {
      if (!checkKingdom(input.kingdomId) || !Number.isFinite(input.atMs) || !REASONS.has(input.reason)) return fail('invalid', 'The refresh request is malformed.');
      const channelId = await ports.kingdom.channelId(input.kingdomId).catch(() => null);
      if (!channelId) return fail('unavailable', 'This kingdom has no bound Twitch channel.');
      const before = await load(input.kingdomId);
      if ('status' in before) return before;
      // A different channel never inherits the previous channel's entries, even through an outage.
      const previous = before.snapshot && before.snapshot.channelId !== channelId ? { ...before.snapshot, providers: {} } : before.snapshot;
      const optIns = { ...before.providers };
      let result: EmoteRefreshResult;
      try {
        result = await refresher.refresh({ kingdomId: input.kingdomId, channelId, reason: input.reason, atMs: input.atMs, thirdParty: optIns, previous }, signal);
      } catch {
        signal.throwIfAborted();
        await recordFailedRead(input.kingdomId, input.atMs);
        return fail('unavailable', 'The catalogue could not be refreshed.');
      }
      const channelNow = await ports.kingdom.channelId(input.kingdomId).catch(() => null);
      if (channelNow !== channelId) return fail('stale', 'The kingdom\'s channel changed while its catalogue was read; read it again.');
      const paletteNow = await palette(input.kingdomId);
      let committed = result.changes;
      const applied = await mutate(input.kingdomId, draft => {
        // A newer refresh committed while this one ran: keep it, never roll it back.
        if (draft.snapshot && draft.snapshot.refreshedAt > input.atMs) return fail('stale', 'A newer refresh has already been stored.');
        const snapshot = structuredClone(result.snapshot), changes = structuredClone(result.changes);
        let providersChanged = false;
        for (const provider of THIRD_PARTY_PROVIDERS) {
          if (draft.providers[provider] === optIns[provider]) continue;
          if (draft.providers[provider]) { providersChanged = true; continue; }
          // Switched off while this read was in flight: what it fetched for the provider is never stored.
          for (const entry of snapshot.providers[provider]?.entries ?? []) {
            changes.withdrawn.push(entry.id);
            for (const list of [changes.added, changes.changed, changes.renamed, changes.unavailable]) { const at = list.indexOf(entry.id); if (at >= 0) list.splice(at, 1); }
          }
          snapshot.providers[provider] = { provider, health: 'disabled', lastSuccessAt: null, attemptedAt: null, problem: null, truncated: false, skipped: [], entries: [] };
        }
        const schedule = draft.schedule ?? emptyEmoteRefreshSchedule();
        const gaps = refreshLeftGaps(snapshot);
        draft.schedule = {
          goLiveEpoch: draft.stream?.live && snapshot.providers.twitch?.health === 'current' ? draft.stream.epoch : schedule.goLiveEpoch,
          providersChanged, failures: gaps ? schedule.failures + 1 : 0, lastAttemptAt: input.atMs,
        };
        draft.snapshot = snapshot;
        draft.refreshedAt = input.atMs;
        reconcile(draft, paletteNow?.paletteRevision ?? null, input.atMs);
        committed = changes;
      });
      return applied.status === 'applied' ? { ...applied, changes: committed } : applied;
    },

    /** When this kingdom's catalogue is read next, and why. Pure over the stored state. */
    async nextRefresh(kingdomId: KingdomId): Promise<EmoteRefreshPlan | EmoteServiceFailure> {
      if (!checkKingdom(kingdomId)) return fail('invalid', 'Unknown kingdom.');
      const state = await load(kingdomId);
      return 'status' in state ? state : planEmoteRefresh(state);
    },

    /**
     * The host's clock for one kingdom: call it after every authoritative stream change and on a
     * timer (`nextAt` says when). Reads the catalogue only when the schedule says so; otherwise it
     * changes nothing and makes no request.
     */
    async tick(input: { kingdomId: KingdomId; atMs: number }, signal: AbortSignal): Promise<(EmoteMutationResult & { reason: EmoteRefreshReason | null; changes?: EmoteCatalogueChanges; nextAt: number | null })> {
      if (!checkKingdom(input.kingdomId) || !Number.isFinite(input.atMs)) return { ...fail('invalid', 'The tick is malformed.'), reason: null, nextAt: null };
      const state = await load(input.kingdomId);
      if ('status' in state) return { ...state, reason: null, nextAt: null };
      const plan = planEmoteRefresh(state);
      if (plan.dueAt > input.atMs) return { status: 'applied', revision: state.revision, reason: null, nextAt: plan.dueAt };
      const result = await service.refresh({ kingdomId: input.kingdomId, reason: plan.reason, atMs: input.atMs }, signal);
      const after = await load(input.kingdomId);
      return { ...result, reason: plan.reason, nextAt: 'status' in after ? null : planEmoteRefresh(after).dueAt };
    },

    /** The monarch opts a third-party provider in or out. Off withdraws its emotes at once and stops every fetch. */
    async setProviderOptIn(input: { kingdomId: KingdomId; provider: ThirdPartyProvider; enabled: boolean }, session: unknown): Promise<EmoteMutationResult> {
      if (!checkKingdom(input.kingdomId) || !THIRD_PARTY_PROVIDERS.includes(input.provider) || typeof input.enabled !== 'boolean') return fail('invalid', 'Choose 7TV, BTTV or FFZ, on or off.');
      const person = await monarch(session, input.kingdomId);
      if (typeof person !== 'string') return person;
      return mutate(input.kingdomId, draft => {
        if (draft.providers[input.provider] === input.enabled) return 'unchanged';
        draft.providers[input.provider] = input.enabled;
        if (input.enabled) draft.schedule = { ...(draft.schedule ?? emptyEmoteRefreshSchedule()), providersChanged: true };
        else reconcile(draft, null, draft.stream?.atMs ?? draft.refreshedAt ?? 0);
      });
    },

    /**
     * The monarch chooses a source for a purpose. `revision` is the source hash they were shown, so a
     * source that changed in the meantime is `stale`. For a third-party emote this is also the
     * per-emote opt-in. It publishes nothing.
     */
    async selectCandidate(input: { kingdomId: KingdomId; id: string; purpose: EmotePurpose; revision: string }, session: unknown): Promise<EmoteMutationResult> {
      if (!checkKingdom(input.kingdomId) || !TokenSchema.safeParse(input.id).success || !PURPOSES.has(input.purpose) || !Sha256Schema.safeParse(input.revision).success) return fail('invalid', 'The selection is malformed.');
      const person = await monarch(session, input.kingdomId);
      if (typeof person !== 'string') return person;
      return mutate(input.kingdomId, draft => {
        const record = sourceRecords(draft).get(input.id);
        if (!record) return fail('not-found', 'That emote is not in the catalogue.');
        if (record.state !== 'ready' || record.sourceHash === null) return fail('unavailable', record.problem?.message ?? 'That emote could not be read.');
        if (record.sourceHash !== input.revision) return fail('stale', 'That emote changed since it was shown.');
        const existing = draft.selections.find(s => s.id === input.id && s.purpose === input.purpose);
        if (existing?.sourceHash === input.revision) return 'unchanged';
        draft.selections = draft.selections.filter(s => s !== existing);
        draft.selections.push({ id: input.id, purpose: input.purpose, sourceHash: input.revision, selectedBy: person, selectedAt: draft.refreshedAt ?? 0 });
      });
    },

    /**
     * Server worker: decodes the selected source from its verified blob, carves it in the kingdom's
     * current palette and stores the compiled geometry content-addressed. The result waits for Luna.
     */
    async prepareCandidate(input: { kingdomId: KingdomId; id: string; purpose: EmotePurpose; atMs: number }, signal: AbortSignal): Promise<EmoteMutationResult & { candidate?: string }> {
      if (!checkKingdom(input.kingdomId) || !PURPOSES.has(input.purpose)) return fail('invalid', 'The request is malformed.');
      return jobs.run(input.kingdomId, async () => {
        const state = await load(input.kingdomId);
        if ('status' in state) return state;
        const selection = state.selections.find(s => s.id === input.id && s.purpose === input.purpose);
        if (!selection) return fail('not-found', 'The monarch has not chosen this emote for that purpose.');
        const record = sourceRecords(state).get(input.id);
        if (!record || record.sourceHash !== selection.sourceHash) return fail('stale', 'The chosen source changed.');
        const kingdomPalette = await palette(input.kingdomId);
        if (!kingdomPalette) return fail('unavailable', 'The kingdom palette could not be read.');
        const bytes = await ports.blobs.get(selection.sourceHash).catch(() => null);
        if (!bytes) return fail('unavailable', 'The source image is not in storage; refresh the catalogue.');
        let decoded;
        try { decoded = await ports.decoder.decode(bytes, record.rendition, signal); } catch {
          signal.throwIfAborted();
          return fail('invalid', 'The source image could not be decoded.');
        }
        const source: EmoteSource = { id: record.id, provider: record.provider, providerId: record.providerId, kingdomId: input.kingdomId, name: record.name, origin: ports.origin, sourceHash: selection.sourceHash, rendition: record.rendition };
        const compiled = compileEmote({ source, decoded }, ports.registry, kingdomPalette.allowedMaterialIds, { purpose: input.purpose, paletteRevision: kingdomPalette.paletteRevision });
        if (!compiled.ok) return fail('invalid', compiled.message);
        const emote = compiled.emote, blob = encodeCompiledEmote(emote), blobHash = sha256Hex(blob);
        try { await ports.blobs.put(blobHash, blob); } catch { return fail('unavailable', 'The carved geometry could not be stored.'); }
        signal.throwIfAborted();
        const applied = await mutate(input.kingdomId, draft => {
          const same = findCandidate(draft, emote.id, emote.purpose, emote.revision);
          if (same && same.state !== 'retired') return 'unchanged';
          const current = sourceRecords(draft).get(input.id);
          if (current?.sourceHash !== selection.sourceHash) return fail('stale', 'The chosen source changed while it was carved.');
          // A fresh carving replaces earlier ones that never reached the monarch; published work stays until it is replaced live.
          for (const older of draft.candidates) {
            if (older.id === emote.id && older.purpose === emote.purpose && ['pending-luna', 'held', 'pending-monarch'].includes(older.state)) {
              older.state = 'retired'; older.retired = { reason: 'replaced', at: input.atMs };
            }
          }
          draft.candidates = draft.candidates.filter(c => !(c.revision === emote.revision && c.id === emote.id && c.state === 'retired'));
          draft.candidates.push({
            id: emote.id, revision: emote.revision, state: 'pending-luna', sourceHash: emote.sourceHash, geometryHash: emote.geometryHash,
            compilerVersion: emote.compilerVersion, paletteRevision: emote.paletteRevision, purpose: emote.purpose, targetHeightCells: emote.targetHeightCells,
            frames: emote.frames.length, periodMs: emote.periodMs, blobHash, createdAt: input.atMs,
            luna: { requestId: null, decision: null, receiptId: null, reviewedGeometryHash: null, at: null },
            monarch: { confirmedBy: null, at: null }, published: null, retired: null,
          });
        });
        return applied.status === 'applied' ? { ...applied, candidate: emote.revision } : applied;
      }, signal);
    },

    /**
     * Server worker, never a public route: sends the stored geometry's contact sheets (every frame,
     * front and side, with a person for scale) to Luna and records the verdict. Approval counts only
     * for the exact geometry hash reviewed. Hold, cold and refuse keep the candidate private.
     * Repeating a `requestId` returns the recorded outcome without asking again.
     */
    async reviewCandidate(input: { kingdomId: KingdomId; id: string; purpose: EmotePurpose; revision: string; requestId: string; atMs?: number }, signal: AbortSignal): Promise<EmoteMutationResult> {
      if (!checkKingdom(input.kingdomId) || !TokenSchema.safeParse(input.requestId).success) return fail('invalid', 'The review request is malformed.');
      return jobs.run(input.kingdomId, async () => {
        const state = await load(input.kingdomId);
        if ('status' in state) return state;
        const candidate = findCandidate(state, input.id, input.purpose, input.revision);
        if (!candidate) return fail('not-found', 'No such candidate.');
        if (candidate.luna.requestId === input.requestId && candidate.luna.decision) return { status: 'applied', revision: state.revision };
        if (candidate.state !== 'pending-luna' && candidate.state !== 'held') return fail('stale', `The candidate is ${candidate.state}, not waiting for review.`);
        const bytes = await ports.blobs.get(candidate.blobHash).catch(() => null);
        const compiled = bytes ? decodeCompiledEmote(bytes) : null;
        if (!compiled || compiled.geometryHash !== candidate.geometryHash) return fail('unavailable', 'The carved geometry is missing or damaged; carve it again.');
        let sheets: Uint8Array[];
        try { sheets = renderContactSheets(compiled, ports.registry); } catch { return fail('invalid', 'The candidate is too large to review.'); }
        let verdict;
        try { verdict = await ports.review.review({ candidate: compiled, contactSheets: sheets, requestId: input.requestId }, signal); } catch {
          signal.throwIfAborted();
          return fail('unavailable', 'The reviewer could not be reached; the candidate stays private.');
        }
        if (!verdict || !DECISIONS.has(verdict.decision) || !TokenSchema.safeParse(verdict.receiptId).success) return fail('invalid', 'The reviewer answered with an unreadable receipt.');
        if (verdict.decision === 'approve' && verdict.reviewedGeometryHash !== candidate.geometryHash) return fail('stale', 'The reviewer approved different geometry.');
        const atMs = input.atMs ?? state.refreshedAt ?? 0;
        return mutate(input.kingdomId, draft => {
          const current = findCandidate(draft, input.id, input.purpose, input.revision);
          if (!current || (current.state !== 'pending-luna' && current.state !== 'held')) return fail('stale', 'The candidate changed during review.');
          current.luna = { requestId: input.requestId, decision: verdict.decision, receiptId: verdict.receiptId, reviewedGeometryHash: verdict.reviewedGeometryHash, at: atMs };
          current.state = verdict.decision === 'approve' ? 'pending-monarch' : verdict.decision === 'hold' ? 'held' : verdict.decision === 'cold' ? 'cold' : 'refused';
        });
      }, signal);
    },

    /** The monarch confirms one reviewed carving. While live it is unveiled at once; otherwise at the next live stream. */
    async confirmCandidate(input: { kingdomId: KingdomId; id: string; purpose: EmotePurpose; revision: string }, session: unknown): Promise<EmoteMutationResult> {
      if (!checkKingdom(input.kingdomId) || !PURPOSES.has(input.purpose) || typeof input.revision !== 'string') return fail('invalid', 'The confirmation is malformed.');
      const person = await monarch(session, input.kingdomId);
      if (typeof person !== 'string') return person;
      const kingdomPalette = await palette(input.kingdomId);
      if (!kingdomPalette) return fail('unavailable', 'The kingdom palette could not be read.');
      return mutate(input.kingdomId, draft => {
        const candidate = findCandidate(draft, input.id, input.purpose, input.revision);
        if (!candidate) return fail('not-found', 'No such candidate.');
        if (candidate.state === 'confirmed' || candidate.state === 'published') return 'unchanged';
        if (candidate.state !== 'pending-monarch') return fail('stale', 'Only a carving the reviewer approved can be confirmed.');
        if (candidate.luna.decision !== 'approve' || candidate.luna.reviewedGeometryHash !== candidate.geometryHash) return fail('stale', 'The review does not cover this geometry.');
        if (invalidation(draft, candidate, kingdomPalette.paletteRevision)) return fail('stale', 'The source, compiler or palette changed since review; carve it again.');
        candidate.state = 'confirmed';
        candidate.monarch = { confirmedBy: person, at: draft.stream?.atMs ?? draft.refreshedAt ?? 0 };
        publishConfirmed(draft, ports.origin, draft.stream?.atMs ?? 0);
      });
    },

    confirmStatue(input: { kingdomId: KingdomId; id: string; revision: string }, session: unknown): Promise<EmoteMutationResult> {
      return service.confirmCandidate({ ...input, purpose: 'statue' }, session);
    },

    /**
     * The host's authoritative stream state, never a browser's. Going live publishes every confirmed
     * carving once per epoch; replaying the same go-live changes nothing.
     */
    async onStreamState(input: { kingdomId: KingdomId; live: boolean; epoch: string; atMs: number }): Promise<EmoteMutationResult> {
      if (!checkKingdom(input.kingdomId) || typeof input.live !== 'boolean' || !TokenSchema.safeParse(input.epoch).success || !Number.isFinite(input.atMs)) return fail('invalid', 'The stream state is malformed.');
      return mutate(input.kingdomId, draft => {
        const same = draft.stream?.live === input.live && draft.stream.epoch === input.epoch;
        if (same && !draft.candidates.some(c => c.state === 'confirmed')) return 'unchanged';
        draft.stream = { live: input.live, epoch: input.epoch, atMs: input.atMs };
        publishConfirmed(draft, ports.origin, input.atMs);
      });
    },

    /** Reveals published but not yet acknowledged by the host. Replayable after a crash. */
    async pendingReveals(kingdomId: KingdomId): Promise<readonly EmoteReveal[]> {
      if (!checkKingdom(kingdomId)) return [];
      const state = await load(kingdomId);
      return 'status' in state ? [] : state.reveals.filter(isPending).map(r => r.reveal);
    },

    /** Called by the authoritative host after its witnessed world commit. Idempotent. */
    async acknowledgeReveal(input: { kingdomId: KingdomId; revealId: string; atMs?: number }): Promise<EmoteMutationResult> {
      if (!checkKingdom(input.kingdomId) || typeof input.revealId !== 'string') return fail('invalid', 'The acknowledgement is malformed.');
      return mutate(input.kingdomId, draft => {
        const record = draft.reveals.find(r => r.reveal.id === input.revealId);
        if (!record) return fail('not-found', 'No such reveal.');
        // Acknowledged before, or withdrawn because its carving retired: nothing left to deliver.
        if (record.acknowledgedAt !== null || record.withdrawnAt) return 'unchanged';
        record.acknowledgedAt = input.atMs ?? draft.stream?.atMs ?? 0;
      });
    },

    /** The monarch's private plaque: sources, candidates and their private states. */
    async privateCandidates(kingdomId: KingdomId, session: unknown): Promise<EmotePrivateCatalogue | EmoteServiceFailure> {
      if (!checkKingdom(kingdomId)) return fail('invalid', 'Unknown kingdom.');
      const person = await monarch(session, kingdomId);
      if (typeof person !== 'string') return person;
      const state = await load(kingdomId);
      if ('status' in state) return state;
      return {
        status: 'ok', kingdomId, revision: state.revision, health: catalogueHealth(state.snapshot), providers: { ...state.providers },
        sources: [...sourceRecords(state).values()].map(r => ({ id: r.id, provider: r.provider, name: r.name, animated: r.animated, state: r.state, sourceHash: r.sourceHash, frames: r.decoded?.frames ?? null, problem: r.problem?.message ?? null })),
        candidates: state.candidates.map(c => ({ id: c.id, purpose: c.purpose, revision: c.revision, state: c.state, frames: c.frames, periodMs: c.periodMs, geometryHash: c.geometryHash, retired: c.retired?.reason ?? null })),
        pendingReveals: state.reveals.filter(isPending).length,
        stream: state.stream,
      };
    },

    /**
     * The public view: only published carvings whose binding still holds, loaded from verified
     * blobs, plus Twitch's flat renditions for inline chat. Third-party flat use needs its own
     * reviewed receipt, so it resolves to null here. Nothing private crosses this boundary.
     */
    async publicCatalogue(kingdomId: KingdomId): Promise<EmoteCatalogueView> {
      const empty = (health: EmoteCatalogueView['health'], revision = 0, checkedAt = 0): EmoteCatalogueView => ({ kingdomId, revision, checkedAt, health, resolveApprovedEmote: () => null, resolveInlineEmote: () => null });
      if (!checkKingdom(kingdomId)) return empty('unavailable');
      const state = await load(kingdomId);
      if ('status' in state) return empty('unavailable');
      const kingdomPalette = await palette(kingdomId);
      const records = sourceRecords(state);
      const approved = new Map<string, ApprovedEmoteVisual>();
      for (const candidate of state.candidates) {
        if (candidate.state !== 'published' || invalidation(state, candidate, kingdomPalette?.paletteRevision ?? null, records)) continue;
        const visual = await loadVisual(candidate);
        if (visual) approved.set(`${candidate.id}|${candidate.purpose}`, visual);
      }
      const flats = new Map<string, InlineEmoteVisual>();
      for (const record of records.values()) {
        if (record.provider !== 'twitch' || record.state !== 'ready' || !record.sourceHash || flats.size >= INLINE_LIMITS.entries) continue;
        let bytes = inline.get(record.sourceHash);
        if (!bytes) {
          const fetched = await ports.blobs.get(record.sourceHash).catch(() => null);
          if (!fetched) continue;
          bytes = fetched; inline.set(record.sourceHash, bytes, bytes.length);
        }
        flats.set(record.id, { id: record.id, revision: record.sourceHash, origin: ports.origin, alt: record.name, mediaType: `image/${record.rendition}` as InlineEmoteVisual['mediaType'], bytes });
      }
      return {
        kingdomId, revision: state.revision, checkedAt: state.refreshedAt ?? 0, health: catalogueHealth(state.snapshot),
        resolveApprovedEmote: (id, purpose) => approved.get(`${id}|${purpose}`) ?? null,
        resolveInlineEmote: id => {
          const flat = flats.get(id);
          return flat ? { ...flat, bytes: flat.bytes.slice() } : null;
        },
      };
    },

    /**
     * Every carving standing in public right now, in a stable order. The scene host diffs this list
     * against what it placed (`diffEmotePlacements`) after each catalogue revision and withdraws,
     * replaces or raises; a withdrawal never says why.
     */
    async publicPlacements(kingdomId: KingdomId): Promise<readonly EmotePlacement[]> {
      if (!checkKingdom(kingdomId)) return [];
      const state = await load(kingdomId);
      if ('status' in state) return [];
      const kingdomPalette = await palette(kingdomId);
      const records = sourceRecords(state);
      return state.candidates
        .filter(c => c.state === 'published' && !invalidation(state, c, kingdomPalette?.paletteRevision ?? null, records))
        .map(c => ({ id: c.id, purpose: c.purpose, revision: c.revision, origin: ports.origin }))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.purpose < b.purpose ? -1 : a.purpose > b.purpose ? 1 : 0);
    },

    /** Server facts for Genesis (`ChannelGenesisFacts.approvedEmotes`): published statues whose approval still holds. */
    async genesisFacts(kingdomId: KingdomId): Promise<EmoteGenesisFact[]> {
      if (!checkKingdom(kingdomId)) return [];
      const state = await load(kingdomId);
      if ('status' in state) return [];
      const kingdomPalette = await palette(kingdomId);
      return state.candidates
        .filter(c => c.purpose === 'statue' && c.state === 'published' && c.luna.receiptId && !invalidation(state, c, kingdomPalette?.paletteRevision ?? null))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .slice(0, 12)
        .map(c => ({ emoteId: c.id, broadcasterId: kingdomId, asset: { assetHash: c.geometryHash, approvalId: c.luna.receiptId! }, allowedUses: ['statue'] }));
    },

    /** Bytes held by the bounded caches, for budgets and tests. */
    cacheStats: () => ({ visuals: visuals.size, visualBytes: visuals.bytes, inline: inline.size, inlineBytes: inline.bytes }),
  };
  return service;
}

export type EmoteCatalogueService = ReturnType<typeof createEmoteCatalogueService>;
