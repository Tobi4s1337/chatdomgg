import { KingdomPresenceFrameSchema, type KingdomId, type KingdomPresenceFrame } from '@chatdom/shared';
import { BANNER_BEAT, BEAT_SPACING_MS, MOMENT_LIMITS, bannerPose, ribbonsFor, type BeatPhase } from './choreography';
import {
  ACTION_KINDS, ActionResultSchema, MOMENT_CURRENT_LIMIT, MomentResetInfoSchema, PresentationSchema, TwitchActionArgsSchema, TwitchActionIntentSchema,
  TwitchMomentFactSchema, type ActionKind, type ActionPort, type ActionResult, type Capability, type MomentBodyOf, type MomentResetInfo,
  type Presentation, type TwitchActionArgs, type TwitchActionIntent, type TwitchMomentFact, type TwitchMomentFeed,
} from './contracts';
import { describeAction } from './previews';

export type FeedStatus = 'waiting' | 'ready' | 'unavailable';
export type FactRejection = 'not-ready' | 'epoch' | 'invalid' | 'kingdom' | 'origin' | 'replay';
export type ResetRejection = 'invalid' | 'kingdom' | 'origin' | 'sequence' | 'partial';

export interface MomentClock { now(): number }

export interface TwitchMomentsOptions {
  readonly kingdomId: KingdomId;
  /** The origin this source must carry. Simulated facts are never accepted as live, or the reverse. */
  readonly expectedOrigin: 'live' | 'simulated';
  readonly clock: MomentClock;
  /** Default: an unbound port, so every write is honestly unavailable. */
  readonly actions?: ActionPort<TwitchActionIntent> | null;
}

export type Tint = 'gold' | 'rose' | 'rainbow';
export interface HomeDressFrame {
  readonly slot: number;
  readonly tier: 'prime' | '1' | '2' | '3';
  readonly active: boolean;
  readonly ribbons: number;
  readonly founder: boolean;
  /** 1 hangs, 0 is furled on its rod. */
  readonly unfurl: number;
  readonly drop: number;
  readonly swing: number;
  readonly swingPhase: number;
  readonly phase: BeatPhase | 'idle';
  /** Only for a present, named window; never for a quiet one. */
  readonly tint: Tint | null;
}
export interface CaptionFrame { readonly id: string; readonly slot: number; readonly title: string; readonly line: string; readonly opacity: number }
export type MomentCue = 'horn' | 'cloth-unfurl';
export interface AudioCueFrame { readonly id: string; readonly cue: MomentCue; readonly atMs: number; readonly gain: number }
export interface FocusFrame { readonly id: string; readonly slot: number; readonly startAt: number; readonly endAt: number; readonly cut: boolean }
export interface MomentMetrics {
  readonly admitted: number;
  readonly restored: number;
  readonly suppressed: Readonly<Record<'expired' | 'recovered' | 'anonymous' | 'coalesced' | 'unchanged', number>>;
  readonly rejected: Readonly<Record<FactRejection | `reset-${ResetRejection}` | 'presence', number>>;
  readonly peak: Readonly<{ beats: number; captions: number; audio: number; current: number }>;
}
export interface MomentFrame {
  readonly atMs: number;
  readonly status: FeedStatus;
  readonly label: 'SIMULATED' | 'LIVE';
  readonly visible: boolean;
  readonly homes: readonly HomeDressFrame[];
  readonly captions: readonly CaptionFrame[];
  readonly audio: readonly AudioCueFrame[];
  readonly focus: FocusFrame | null;
}

interface Beat { readonly id: string; readonly kind: 'home-banner'; readonly slot: number; readonly name: string; readonly line: string; readonly startAt: number; readonly endAt: number }
interface HomeDress { readonly tier: HomeDressFrame['tier']; readonly active: boolean; readonly months: number; readonly founder: boolean }

export type ActionAttempt = ActionResult | { readonly status: 'in-flight'; readonly intentId: string } | { readonly status: 'invalid'; readonly intentId: string | null };
export type ActionPreview =
  | { readonly ok: true; readonly kind: ActionKind; readonly title: string; readonly lines: readonly string[]; readonly capability: Capability }
  | { readonly ok: false; readonly reason: 'invalid' };

const UNAVAILABLE: Capability = { available: false, reason: 'unavailable', retryAt: null };
/** No bound action service: every capability is unavailable and nothing is ever dispatched. */
export function createUnavailableActionPort(): ActionPort<TwitchActionIntent> {
  return {
    capabilities: () => new Map(ACTION_KINDS.map(kind => [kind, UNAVAILABLE])),
    submit: async intent => ({ status: 'unavailable', intentId: intent.id }),
    reconcile: async () => { throw new Error('No action service is bound, so nothing can be reconciled'); },
  };
}

const truncate = (name: string) => [...name].length > MOMENT_LIMITS.nameLength ? `${[...name].slice(0, MOMENT_LIMITS.nameLength - 1).join('')}…` : name;
const TINT: Record<HomeDressFrame['tier'], Tint> = { prime: 'gold', 1: 'gold', 2: 'rose', 3: 'rainbow' };

/**
 * The pure clocked controller. Validates every external value at entry, keeps bounded current state, schedules
 * beats on the supplied kingdom clock and samples bounded visual/director/audio commands. It mutates no world.
 */
export function createTwitchMoments(options: TwitchMomentsOptions) {
  const { kingdomId, expectedOrigin, clock } = options;
  const actions = options.actions ?? createUnavailableActionPort();
  let status: FeedStatus = 'waiting', epoch: string | null = null, watermark = 0, disposed = false;
  const current = new Map<string, TwitchMomentFact>();
  const homes = new Map<number, HomeDress>();
  let beats: Beat[] = [], lastBeatStart = -Infinity, presence: KingdomPresenceFrame | null = null;
  let presentation: Presentation = { layout: 'stage', mood: 'show', busy: false, visible: true, safeRects: [], autoOpenKinds: [] };
  const inFlight = new Map<string, Promise<ActionAttempt>>();
  const metrics = {
    admitted: 0, restored: 0,
    suppressed: { expired: 0, recovered: 0, anonymous: 0, coalesced: 0, unchanged: 0 },
    rejected: { 'not-ready': 0, epoch: 0, invalid: 0, kingdom: 0, origin: 0, replay: 0, 'reset-invalid': 0, 'reset-kingdom': 0, 'reset-origin': 0,
      'reset-sequence': 0, 'reset-partial': 0, presence: 0 },
    peak: { beats: 0, captions: 0, audio: 0, current: 0 },
  };

  function cancelTransient(): void { beats = []; lastBeatStart = -Infinity; }

  function applyState(fact: TwitchMomentFact): void {
    current.set(fact.body.key, fact);
    metrics.peak.current = Math.max(metrics.peak.current, current.size);
    const body = fact.body;
    if (body.kind === 'subscription' && body.credit?.slot != null) {
      homes.set(body.credit.slot, { tier: body.tier, active: body.active, months: body.months, founder: body.founder });
    }
  }

  function scheduleBeat(fact: TwitchMomentFact, body: MomentBodyOf<'subscription'>): void {
    if (!body.credit || body.credit.slot === null) { metrics.suppressed.anonymous++; return; }
    if (!body.active) { metrics.suppressed.unchanged++; return; }
    const now = clock.now();
    if (beats.filter(b => b.endAt > now).length >= MOMENT_LIMITS.pendingBeats) { metrics.suppressed.coalesced++; return; }
    const startAt = Math.max(now, lastBeatStart + BEAT_SPACING_MS);
    lastBeatStart = startAt;
    const name = truncate(body.credit.displayName);
    const beat: Beat = { id: `${fact.body.key}@${fact.seq}`, kind: 'home-banner', slot: body.credit.slot, name, line: 'raises a banner at home',
      startAt, endAt: startAt + BANNER_BEAT.end };
    beats = [...beats.filter(b => b.endAt > now), beat].slice(-MOMENT_LIMITS.beats);
    metrics.admitted++;
    metrics.peak.beats = Math.max(metrics.peak.beats, beats.length);
  }

  function admit(fact: TwitchMomentFact): void {
    applyState(fact);
    const now = clock.now();
    if (fact.origin === 'recovered') { metrics.suppressed.recovered++; return; }
    if (now > fact.body.displayUntil || fact.body.displayUntil === fact.occurredAt) { metrics.suppressed.expired++; return; }
    if (fact.body.kind === 'subscription') scheduleBeat(fact, fact.body);
  }

  const originOk = (origin: TwitchMomentFact['origin']) => origin === expectedOrigin || origin === 'recovered';

  function reset(input: MomentResetInfo | unknown): { accepted: true } | { accepted: false; reason: ResetRejection } {
    if (disposed) return { accepted: false, reason: 'invalid' };
    const fail = (reason: ResetRejection) => { metrics.rejected[`reset-${reason}`]++; markUnavailable(); return { accepted: false as const, reason }; };
    const raw = input as { current?: unknown };
    if (Array.isArray(raw?.current) && raw.current.length > MOMENT_CURRENT_LIMIT) return fail('partial');
    const info = MomentResetInfoSchema.safeParse(input);
    if (!info.success) return fail('invalid');
    const facts: TwitchMomentFact[] = [];
    for (const item of info.data.current) {
      const fact = TwitchMomentFactSchema.safeParse(item);
      if (!fact.success) return fail('invalid');
      if (fact.data.kingdomId !== kingdomId) return fail('kingdom');
      if (!originOk(fact.data.origin)) return fail('origin');
      if (fact.data.seq > info.data.throughSeq) return fail('sequence');
      facts.push(fact.data);
    }
    // Replace bounded state; a restored snapshot has no "just happened" beat.
    cancelTransient(); current.clear(); homes.clear();
    for (const fact of facts.sort((a, b) => a.seq - b.seq)) applyState(fact);
    metrics.restored += facts.length;
    epoch = info.data.epoch; watermark = info.data.throughSeq; status = 'ready';
    return { accepted: true };
  }

  function receiveFact(factEpoch: string, input: unknown): { accepted: true } | { accepted: false; reason: FactRejection } {
    const reject = (reason: FactRejection) => { metrics.rejected[reason]++; return { accepted: false as const, reason }; };
    if (disposed || status !== 'ready') return reject('not-ready');
    if (factEpoch !== epoch) return reject('epoch');
    const parsed = TwitchMomentFactSchema.safeParse(input);
    if (!parsed.success) return reject('invalid');
    const fact = parsed.data;
    if (fact.kingdomId !== kingdomId) return reject('kingdom');
    if (!originOk(fact.origin)) return reject('origin');
    if (fact.seq <= watermark) return reject('replay');
    watermark = fact.seq;
    admit(fact);
    return { accepted: true };
  }

  function markUnavailable(): void {
    // Transient effects, leases and previews end; known homes and earned pieces stay as they were.
    status = 'unavailable'; epoch = null; cancelTransient();
  }

  function receivePresence(input: unknown): boolean {
    const parsed = KingdomPresenceFrameSchema.safeParse(input);
    if (!parsed.success || parsed.data.kingdomId !== kingdomId || parsed.data.origin !== expectedOrigin) { metrics.rejected.presence++; return false; }
    const next = parsed.data;
    if (presence && presence.epoch === next.epoch && next.sequence <= presence.sequence) return false;
    presence = next;
    return true;
  }

  function sample(atMs: number): MomentFrame {
    const visible = presentation.visible && !disposed;
    const named = new Set((presence?.connection === 'fresh' ? presence.windows : []).filter(w => w.present && w.publicName !== null).map(w => w.slot));
    // Upcoming beats wait for their turn on the spacing clock; live ones are past their start.
    const live = visible ? beats.filter(b => atMs < b.endAt) : [];
    const frames: HomeDressFrame[] = [];
    for (const [slot, dress] of homes) {
      const beat = live.find(b => b.slot === slot && atMs >= b.startAt);
      const pending = live.some(b => b.slot === slot && atMs < b.startAt);
      const pose = beat ? bannerPose(atMs - beat.startAt) : null;
      // A home whose banner is about to arrive shows nothing yet; afterwards it flies, or furls when lapsed.
      if (pending && !beat) continue;
      frames.push({ slot, tier: dress.tier, active: dress.active, ribbons: ribbonsFor(dress.months), founder: dress.founder,
        unfurl: pose ? pose.unfurl : dress.active ? 1 : 0, drop: pose?.drop ?? 0, swing: pose?.swing ?? 0, swingPhase: pose?.swingPhase ?? 0,
        phase: pose?.phase ?? 'idle', tint: dress.active && named.has(slot) ? TINT[dress.tier] : null });
    }
    const captions: CaptionFrame[] = [];
    const audio: AudioCueFrame[] = [];
    let focus: FocusFrame | null = null;
    for (const beat of live) {
      if (atMs < beat.startAt) continue;
      const pose = bannerPose(atMs - beat.startAt);
      if (pose.caption > 0.01 && captions.length < MOMENT_LIMITS.captions) captions.push({ id: beat.id, slot: beat.slot, title: beat.name, line: beat.line, opacity: pose.caption });
      if (!focus && !presentation.busy) focus = { id: beat.id, slot: beat.slot, startAt: beat.startAt, endAt: beat.endAt, cut: presentation.mood === 'show' };
    }
    // Every cue of a live beat is listed with its absolute time; the view plays each ID once and cancels on removal.
    for (const beat of live) {
      if (audio.length + 2 > MOMENT_LIMITS.audio) break;
      audio.push({ id: `${beat.id}:horn`, cue: 'horn', atMs: beat.startAt + BANNER_BEAT.horn, gain: 1 },
        { id: `${beat.id}:cloth`, cue: 'cloth-unfurl', atMs: beat.startAt + BANNER_BEAT.cloth, gain: 0.8 });
    }
    metrics.peak.captions = Math.max(metrics.peak.captions, captions.length);
    metrics.peak.audio = Math.max(metrics.peak.audio, audio.length);
    return { atMs, status, label: expectedOrigin === 'simulated' ? 'SIMULATED' : 'LIVE', visible, homes: frames.sort((a, b) => a.slot - b.slot), captions, audio, focus };
  }

  function setPresentation(input: unknown): boolean {
    const parsed = PresentationSchema.safeParse(input);
    if (!parsed.success) return false;
    if (!parsed.data.visible && presentation.visible) cancelTransient();
    presentation = parsed.data;
    return true;
  }

  function previewAction(input: unknown): ActionPreview {
    const args = TwitchActionArgsSchema.safeParse(input);
    if (!args.success) return { ok: false, reason: 'invalid' };
    const { title, lines } = describeAction(args.data);
    const capability = actions.capabilities().get(args.data.kind) ?? UNAVAILABLE;
    return { ok: true, kind: args.data.kind, title, lines, capability };
  }

  function submitAction(input: unknown): Promise<ActionAttempt> {
    const intent = TwitchActionIntentSchema.safeParse(input);
    if (!intent.success) return Promise.resolve({ status: 'invalid', intentId: null });
    const { id } = intent.data, kind: TwitchActionArgs['kind'] = intent.data.args.kind;
    const same = inFlight.get(id);
    if (same) return same;
    if ([...inFlight.keys()].some(key => key.endsWith(`|${kind}`))) return Promise.resolve({ status: 'in-flight', intentId: id });
    const capability = actions.capabilities().get(kind) ?? UNAVAILABLE;
    if (!capability.available) return Promise.resolve({ status: 'unavailable', intentId: id });
    const controller = new AbortController();
    const attempt = actions.submit(intent.data, controller.signal).then(result => {
      const parsed = ActionResultSchema.safeParse(result);
      // A malformed answer after dispatch is uncertainty, never success.
      return parsed.success && parsed.data.intentId === id ? parsed.data : { status: 'unknown' as const, intentId: id, reconciliationKey: id };
    }, () => ({ status: 'unknown' as const, intentId: id, reconciliationKey: id }))
      .finally(() => { inFlight.delete(id); inFlight.delete(`${id}|${kind}`); });
    inFlight.set(id, attempt); inFlight.set(`${id}|${kind}`, attempt);
    return attempt;
  }

  return {
    reset,
    receiveFact,
    receivePresence,
    setPresentation,
    sample,
    previewAction,
    submitAction,
    /** Wire an injected feed. Its origin must be the one this controller expects. */
    connect(feed: TwitchMomentFeed): () => void {
      if (feed.origin !== expectedOrigin) { markUnavailable(); return () => {}; }
      return feed.subscribe(info => { reset(info); }, (factEpoch, fact) => { receiveFact(factEpoch, fact); }, () => markUnavailable());
    },
    markUnavailable,
    get status() { return status; },
    get epoch() { return epoch; },
    metrics: (): MomentMetrics => structuredClone(metrics),
    /** Public current state as received, for inspection; never includes private IDs. */
    currentFacts: (): readonly TwitchMomentFact[] => [...current.values()],
    dispose() { disposed = true; cancelTransient(); current.clear(); homes.clear(); presence = null; inFlight.clear(); },
  };
}
export type TwitchMoments = ReturnType<typeof createTwitchMoments>;
