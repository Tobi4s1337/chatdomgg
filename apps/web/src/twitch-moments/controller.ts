import { KingdomPresenceFrameSchema, type KingdomId, type KingdomPresenceFrame } from '@chatdom/shared';
import {
  BANNER_BEAT, BEAT_SPACING_MS, CART_BEAT, FLOURISH_BEAT, GIFT_LIMITS, MOMENT_LIMITS, PARCEL_BEAT, PARCEL_REST_MS, bannerPose, flourishPose, quietFurl,
  ribbonsFor, type BeatPhase,
} from './choreography';
import {
  ACTION_KINDS, ActionResultSchema, MOMENT_CURRENT_LIMIT, MomentResetInfoSchema, PresentationSchema, TwitchActionArgsSchema, TwitchActionIntentSchema,
  TwitchMomentFactSchema, type ActionKind, type ActionPort, type ActionResult, type Capability, type MomentBodyOf, type MomentResetInfo,
  type Presentation, type TwitchActionArgs, type TwitchActionIntent, type TwitchMomentFact, type TwitchMomentFeed,
} from './contracts';
import {
  FRIEND, cartLoad, destinationOf, extendGiftBeat, giftSeal, planGiftBeat, recipientLine, type GiftBeat, type GiftDestination, type GiftSeal, type GiftTier,
} from './gift-beat';
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
/** What a shot or a caption is about: a supplied home, or a supplied public place. Never a guessed address. */
export type MomentSubject = { readonly kind: 'home'; readonly slot: number } | { readonly kind: 'place'; readonly place: 'market' | 'gate' };
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
  /** The newest ribbon's fall from its knot during a shared resub, 0..1 (1 hangs). */
  readonly ribbonDrop: number;
  /** Only for a present, named window; never for a quiet one. */
  readonly tint: Tint | null;
}
export interface CaptionFrame {
  readonly id: string;
  readonly at: MomentSubject;
  readonly title: string;
  readonly line: string;
  readonly detail: string | null;
  readonly opacity: number;
}
export type MomentCue = 'horn' | 'cloth-unfurl' | 'gift-bell' | 'cart-roll' | 'parcel-land';
export interface AudioCueFrame { readonly id: string; readonly cue: MomentCue; readonly atMs: number; readonly gain: number }
export interface FocusFrame {
  readonly id: string;
  readonly subject: MomentSubject;
  readonly startAt: number;
  readonly endAt: number;
  readonly cut: boolean;
  /** A gathering (a cart and its waves) wants the wider shot; a home wants the close one. */
  readonly wide: boolean;
  /**
   * A second subject the shot follows to: an intimate cart's first named parcel, picked up mid-flight so it
   * settles on its own doorstep in frame. Null keeps the one shot.
   */
  readonly follow: { readonly subject: MomentSubject; readonly at: number } | null;
  /** Where the beat's located parcels are bound (at most twelve), so a gathering shot looks toward them. */
  readonly toward: readonly MomentSubject[];
}
/** One parcel: in flight (`elapsed` ms since its launch) or resting at its destination (`elapsed` null). */
export interface ParcelFrame {
  readonly key: string;
  readonly tier: GiftTier;
  readonly seal: GiftSeal;
  readonly to: GiftDestination;
  readonly fromSky: boolean;
  readonly flight: number;
  readonly elapsed: number | null;
}
export interface CartFrame {
  readonly id: string;
  readonly tier: GiftTier;
  readonly seal: GiftSeal;
  /** Ms into the cart's beat, and when (in the same frame of reference) it rolls on. */
  readonly t: number;
  readonly departAt: number;
  /** Parcels still on the bed, bounded for display. */
  readonly load: number;
}
export interface MomentMetrics {
  readonly admitted: number;
  readonly restored: number;
  readonly suppressed: Readonly<Record<'expired' | 'recovered' | 'anonymous' | 'coalesced' | 'unchanged', number>>;
  readonly rejected: Readonly<Record<FactRejection | `reset-${ResetRejection}` | 'presence', number>>;
  readonly peak: Readonly<{ beats: number; captions: number; audio: number; current: number; parcels: number }>;
}
export interface MomentFrame {
  readonly atMs: number;
  readonly status: FeedStatus;
  readonly label: 'SIMULATED' | 'LIVE';
  readonly visible: boolean;
  readonly homes: readonly HomeDressFrame[];
  readonly parcels: readonly ParcelFrame[];
  readonly carts: readonly CartFrame[];
  readonly captions: readonly CaptionFrame[];
  readonly audio: readonly AudioCueFrame[];
  readonly focus: FocusFrame | null;
}

interface BannerBeat {
  readonly kind: 'home-banner';
  /** A furled or new banner unfurls; one already flying lifts in a gust and gains its ribbon. */
  readonly style: 'unfurl' | 'flourish';
  readonly id: string; readonly slot: number; readonly name: string; readonly line: string; readonly startAt: number; readonly endAt: number;
  readonly newRibbon: boolean;
}
type Beat = BannerBeat | GiftBeat;
interface HomeDress {
  readonly tier: HomeDressFrame['tier']; readonly active: boolean; readonly months: number; readonly founder: boolean;
  /** Kingdom time of a live quiet change, and the cloth's rest before it; restoration has no motion. */
  readonly changedAt: number; readonly fromUnfurl: number;
}

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
/** Prime and tier 1 are the same rank: moving between them is never an upgrade. */
const RANK: Record<HomeDressFrame['tier'], number> = { prime: 1, 1: 1, 2: 2, 3: 3 };
/** A gift group's first notice waits this long for its siblings, so the aggregate and its recipients start one beat. */
const GIFT_GATHER_MS = 1200;

/** An intimate cart hands the shot to its first parcel bound for a home, a little before halfway through its flight. */
function followOf(beat: GiftBeat): FocusFrame['follow'] {
  if (beat.mode !== 'cart' || !beat.intimate) return null;
  const first = beat.parcels.filter(p => p.to.kind === 'home' && p.launchAt !== null).sort((a, b) => a.launchAt! - b.launchAt!)[0];
  if (!first || first.to.kind !== 'home') return null;
  return { subject: { kind: 'home', slot: first.to.slot }, at: first.launchAt! + PARCEL_BEAT.lift + first.flight * 0.4 };
}
/** The distinct places a cart's parcels fly to, in launch order, bounded for the shot's composition. */
function towardOf(beat: GiftBeat): MomentSubject[] {
  if (beat.mode !== 'cart') return [];
  const seen = new Set<string>(), out: MomentSubject[] = [];
  for (const p of beat.parcels) {
    const id = p.to.kind === 'home' ? `home:${p.to.slot}` : 'gate';
    if (p.launchAt === null || seen.has(id) || out.length >= 12) continue;
    seen.add(id); out.push(subjectOf(p.to));
  }
  return out;
}
/** Gift groups already celebrated in this session; a later update to one is state only. Bounded, oldest first out. */
const CELEBRATED_LIMIT = 256;
const subjectOf = (to: GiftDestination): MomentSubject => to.kind === 'home' ? { kind: 'home', slot: to.slot } : { kind: 'place', place: 'gate' };
const smoothIn = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

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
  let beats: Beat[] = [], nextSlotAt = -Infinity, presence: KingdomPresenceFrame | null = null;
  const celebrated = new Set<string>();
  let presentation: Presentation = { layout: 'stage', mood: 'show', busy: false, visible: true, safeRects: [], autoOpenKinds: [] };
  const inFlight = new Map<string, Promise<ActionAttempt>>();
  const metrics = {
    admitted: 0, restored: 0,
    suppressed: { expired: 0, recovered: 0, anonymous: 0, coalesced: 0, unchanged: 0 },
    rejected: { 'not-ready': 0, epoch: 0, invalid: 0, kingdom: 0, origin: 0, replay: 0, 'reset-invalid': 0, 'reset-kingdom': 0, 'reset-origin': 0,
      'reset-sequence': 0, 'reset-partial': 0, presence: 0 },
    peak: { beats: 0, captions: 0, audio: 0, current: 0, parcels: 0 },
  };

  function cancelTransient(): void { beats = []; nextSlotAt = -Infinity; }

  /** Current public state. A live change of a known home eases its cloth quietly; restoration simply is. */
  function applyState(fact: TwitchMomentFact, live: boolean): void {
    current.set(fact.body.key, fact);
    metrics.peak.current = Math.max(metrics.peak.current, current.size);
    const body = fact.body;
    if (body.kind === 'subscription' && body.credit?.slot != null) {
      const previous = homes.get(body.credit.slot), now = clock.now();
      const moved = live && previous !== undefined && previous.active !== body.active;
      homes.set(body.credit.slot, { tier: body.tier, active: body.active, months: body.months, founder: body.founder,
        changedAt: moved ? now : -Infinity, fromUnfurl: moved ? restUnfurl(previous, now) : body.active ? 1 : 0 });
    }
  }

  function restUnfurl(dress: HomeDress, atMs: number): number {
    const target = dress.active ? 1 : 0;
    return dress.fromUnfurl + (target - dress.fromUnfurl) * quietFurl(atMs - dress.changedAt);
  }

  const pending = (now: number) => beats.filter(b => b.endAt > now);

  /** One subject at a time: a beat starts once the previous one has had the stage, never in a queue of thanks. */
  function slot(now: number, earliest: number): number | null {
    if (pending(now).length >= MOMENT_LIMITS.pendingBeats) { metrics.suppressed.coalesced++; return null; }
    return Math.max(earliest, nextSlotAt);
  }

  function push(beat: Beat, holdsFor: number, now: number): void {
    nextSlotAt = beat.startAt + holdsFor;
    beats = [...pending(now), beat].slice(-MOMENT_LIMITS.beats);
    metrics.admitted++;
    metrics.peak.beats = Math.max(metrics.peak.beats, beats.length);
  }

  function scheduleBanner(fact: TwitchMomentFact, body: MomentBodyOf<'subscription'>, previous: HomeDress | undefined): void {
    if (!body.credit || body.credit.slot === null) { metrics.suppressed.anonymous++; return; }
    if (!body.active) { metrics.suppressed.unchanged++; return; }
    const now = clock.now(), startAt = slot(now, now);
    if (startAt === null) return;
    const flying = previous?.active === true;
    const style: BannerBeat['style'] = flying ? 'flourish' : 'unfurl';
    const newRibbon = flying && ribbonsFor(body.months) > ribbonsFor(previous.months);
    const upgraded = flying && RANK[body.tier] > RANK[previous.tier];
    const line = upgraded ? (body.tier === '3' ? 'unfurls the rainbow cape' : 'hangs the rose cloak')
      : body.sharedNotice ? `${body.months} ${body.months === 1 ? 'month' : 'months'} under the banner`
      : previous && !previous.active ? 'raises the banner again' : 'raises a banner at home';
    const length = style === 'unfurl' ? BANNER_BEAT.end : FLOURISH_BEAT.end;
    push({ kind: 'home-banner', style, id: `${body.key}@${fact.seq}`, slot: body.credit.slot, name: truncate(body.credit.displayName), line, startAt,
      endAt: startAt + length, newRibbon }, Math.min(length, BEAT_SPACING_MS), now);
  }

  /**
   * One beat per gift group. Later public updates for the same group fold into its beat (new parcels join the
   * next wave) or, once it has been celebrated, only update state: correlated notices never rain twice.
   */
  function scheduleGift(fact: TwitchMomentFact, body: MomentBodyOf<'gifts'>): void {
    const now = clock.now();
    const index = beats.findIndex(b => b.kind === 'gift' && b.groupKey === body.groupKey && b.endAt > now);
    if (index >= 0) {
      const beat = beats[index] as GiftBeat;
      // Before it starts, the beat is simply re-planned from the group's latest state.
      const next = now < beat.startAt ? planGiftBeat(beat.id, body, beat.startAt, truncate) : extendGiftBeat(beat, body, now, truncate);
      beats = beats.map((b, i) => (i === index ? next : b));
      if (next.mode === 'cart') nextSlotAt = Math.max(nextSlotAt, next.departAt);
      metrics.suppressed.coalesced++;
      return;
    }
    if (celebrated.has(body.groupKey)) { metrics.suppressed.coalesced++; return; }
    const startAt = slot(now, now + GIFT_GATHER_MS);
    if (startAt === null) return;
    const beat = planGiftBeat(`${body.key}@${fact.seq}`, body, startAt, truncate);
    celebrated.add(body.groupKey);
    if (celebrated.size > CELEBRATED_LIMIT) celebrated.delete(celebrated.values().next().value!);
    push(beat, beat.mode === 'cart' ? beat.departAt - startAt : Math.min(beat.endAt - startAt, 5200), now);
  }

  function admit(fact: TwitchMomentFact): void {
    const body = fact.body;
    const previous = body.kind === 'subscription' && body.credit?.slot != null ? homes.get(body.credit.slot) : undefined;
    applyState(fact, fact.origin !== 'recovered');
    const now = clock.now();
    if (fact.origin === 'recovered') { metrics.suppressed.recovered++; return; }
    if (now > body.displayUntil || body.displayUntil === fact.occurredAt) { metrics.suppressed.expired++; return; }
    if (body.kind === 'subscription') scheduleBanner(fact, body, previous);
    else if (body.kind === 'gifts') scheduleGift(fact, body);
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
    for (const fact of facts.sort((a, b) => a.seq - b.seq)) {
      applyState(fact, false);
      // A restored group was someone's moment already; a late sibling notice for it is state only.
      if (fact.body.kind === 'gifts') celebrated.add(fact.body.groupKey);
    }
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
    const banners = live.filter((b): b is BannerBeat => b.kind === 'home-banner'), gifts = live.filter((b): b is GiftBeat => b.kind === 'gift');
    const homeFrames: HomeDressFrame[] = [];
    for (const [slot, dress] of homes) {
      const beat = banners.find(b => b.slot === slot && atMs >= b.startAt);
      const waiting = banners.some(b => b.slot === slot && atMs < b.startAt && b.style === 'unfurl');
      // A home whose banner is about to arrive shows nothing yet; afterwards it flies, or furls when lapsed.
      if (waiting && !beat) continue;
      const base = { slot, tier: dress.tier, active: dress.active, ribbons: ribbonsFor(dress.months), founder: dress.founder,
        tint: dress.active && named.has(slot) ? TINT[dress.tier] : null };
      if (beat?.style === 'unfurl') {
        const pose = bannerPose(atMs - beat.startAt);
        homeFrames.push({ ...base, unfurl: pose.unfurl, drop: pose.drop, swing: pose.swing, swingPhase: pose.swingPhase, phase: pose.phase, ribbonDrop: 1 });
      } else if (beat) {
        const pose = flourishPose(atMs - beat.startAt);
        homeFrames.push({ ...base, unfurl: 1, drop: 0, swing: pose.swing, swingPhase: pose.swingPhase, phase: pose.phase, ribbonDrop: beat.newRibbon ? pose.ribbonDrop : 1 });
      } else {
        homeFrames.push({ ...base, unfurl: restUnfurl(dress, atMs), drop: 0, swing: 0, swingPhase: 0, phase: 'idle', ribbonDrop: 1 });
      }
    }

    const parcels = parcelFrames(gifts, atMs);
    const carts: CartFrame[] = gifts.filter(b => b.mode === 'cart' && atMs >= b.startAt)
      .map(b => ({ id: b.id, tier: b.tier, seal: b.seal, t: atMs - b.startAt, departAt: b.departAt - b.startAt, load: cartLoad(b, atMs) }));

    const captions: CaptionFrame[] = [];
    const caption = (frame: CaptionFrame) => { if (frame.opacity > 0.01 && captions.length < MOMENT_LIMITS.captions) captions.push(frame); };
    let focus: FocusFrame | null = null;
    for (const beat of live) {
      if (atMs < beat.startAt) continue;
      const t = atMs - beat.startAt;
      if (beat.kind === 'home-banner') {
        const opacity = beat.style === 'unfurl' ? bannerPose(t).caption : flourishPose(t).caption;
        caption({ id: beat.id, at: { kind: 'home', slot: beat.slot }, title: beat.name, line: beat.line, detail: null, opacity });
        if (!focus && !presentation.busy) focus = { id: beat.id, subject: { kind: 'home', slot: beat.slot }, startAt: beat.startAt, endAt: beat.endAt, cut: presentation.mood === 'show', wide: false, follow: null, toward: [] };
        continue;
      }
      for (const frame of giftCaptions(beat, atMs)) caption(frame);
      const subject: MomentSubject = beat.mode === 'cart' ? { kind: 'place', place: 'market' } : subjectOf(beat.parcels[0]!.to);
      if (!focus && !presentation.busy) focus = { id: beat.id, subject, startAt: beat.startAt, endAt: beat.endAt, cut: presentation.mood === 'show', wide: beat.mode === 'cart', follow: followOf(beat), toward: towardOf(beat) };
    }

    // Every cue of a live beat is listed with its absolute time; the view plays each ID once and cancels on removal.
    const audio: AudioCueFrame[] = [];
    for (const beat of live) {
      const cues = beat.kind === 'home-banner' ? bannerCues(beat) : giftCues(beat);
      if (audio.length + cues.length > MOMENT_LIMITS.audio) break;
      audio.push(...cues);
    }
    metrics.peak.captions = Math.max(metrics.peak.captions, captions.length);
    metrics.peak.audio = Math.max(metrics.peak.audio, audio.length);
    metrics.peak.parcels = Math.max(metrics.peak.parcels, parcels.length);
    return { atMs, status, label: expectedOrigin === 'simulated' ? 'SIMULATED' : 'LIVE', visible, homes: homeFrames.sort((a, b) => a.slot - b.slot),
      parcels, carts, captions, audio, focus };
  }

  /**
   * Parcels in flight from live beats, then parcels resting at their doorsteps for the night, newest group first.
   * A parcel whose beat has not reached it yet is nowhere: it is still on the cart, or not yet sent.
   */
  function parcelFrames(gifts: readonly GiftBeat[], atMs: number): ParcelFrame[] {
    const out: ParcelFrame[] = [], covered = new Set(gifts.flatMap(b => b.parcels.map(p => p.key)));
    for (const beat of gifts) for (const p of beat.parcels) {
      if (p.launchAt !== null && atMs >= p.launchAt && atMs < p.restFrom) {
        if (out.length < GIFT_LIMITS.flights) out.push({ key: p.key, tier: beat.tier, seal: beat.seal, to: p.to, fromSky: p.fromSky, flight: p.flight, elapsed: atMs - p.launchAt });
      } else if (atMs >= p.restFrom) {
        out.push({ key: p.key, tier: beat.tier, seal: beat.seal, to: p.to, fromSky: p.fromSky, flight: p.flight, elapsed: null });
      }
    }
    const resting = [...current.values()].filter(f => f.body.kind === 'gifts' && atMs < f.occurredAt + PARCEL_REST_MS).sort((a, b) => b.seq - a.seq);
    let rest = out.filter(p => p.elapsed === null).length;
    for (const fact of resting) {
      const body = fact.body as MomentBodyOf<'gifts'>;
      for (const r of body.recipients) {
        const to = destinationOf(r.credit);
        if (!to || covered.has(r.noticeKey) || rest >= GIFT_LIMITS.resting) continue;
        covered.add(r.noticeKey); rest++;
        out.push({ key: r.noticeKey, tier: body.tier, seal: giftSeal(body), to, fromSky: false, flight: 0, elapsed: null });
      }
    }
    return out;
  }

  function giftCaptions(beat: GiftBeat, atMs: number): CaptionFrame[] {
    const t = atMs - beat.startAt, out: CaptionFrame[] = [];
    const line = beat.forwardedFrom ? `pays forward ${beat.forwardedFrom}’s gift` : beat.total === 1 ? 'sends a gift' : `sends ${beat.total} gifts`;
    const names = beat.parcels.flatMap(p => (p.name ? [p.name] : []));
    if (beat.mode === 'single') {
      const p = beat.parcels[0]!, land = p.restFrom - PARCEL_BEAT.canopyAway - beat.startAt;
      const opacity = smoothIn(land - 1400, land - 700, t) * (1 - smoothIn(beat.endAt - beat.startAt - 1100, beat.endAt - beat.startAt - 200, t));
      out.push({ id: beat.id, at: subjectOf(p.to), title: beat.giver, line, detail: p.name ? `for ${p.name}` : null, opacity });
      return out;
    }
    const fade = beat.departAt - beat.startAt + CART_BEAT.depart * 0.25;
    const opacity = smoothIn(CART_BEAT.captionIn[0], CART_BEAT.captionIn[1], t) * (1 - smoothIn(fade, fade + CART_BEAT.captionFade, t));
    out.push({ id: beat.id, at: { kind: 'place', place: 'market' }, title: beat.giver, line, detail: recipientLine(beat, names), opacity });
    // Five people get intimate acknowledgement: each named home's landing reads its name for a moment.
    if (beat.intimate) for (const p of beat.parcels) {
      if (p.launchAt === null || p.to.kind !== 'home' || !p.name) continue;
      const land = p.restFrom - PARCEL_BEAT.canopyAway;
      const o = smoothIn(land - 200, land + 300, atMs) * (1 - smoothIn(land + 2400, land + 3000, atMs));
      if (o > 0.01) out.push({ id: `${beat.id}:${p.key}`, at: subjectOf(p.to), title: p.name, line: beat.giver === FRIEND ? 'a gift from a friend of the realm' : `a gift from ${beat.giver}`, detail: null, opacity: o });
    }
    return out;
  }

  function bannerCues(beat: BannerBeat): AudioCueFrame[] {
    const timing = beat.style === 'unfurl' ? BANNER_BEAT : FLOURISH_BEAT, quiet = beat.style === 'unfurl' ? 1 : 0.7;
    return [{ id: `${beat.id}:horn`, cue: 'horn', atMs: beat.startAt + timing.horn, gain: quiet },
      { id: `${beat.id}:cloth`, cue: 'cloth-unfurl', atMs: beat.startAt + timing.cloth, gain: 0.8 * quiet }];
  }

  function giftCues(beat: GiftBeat): AudioCueFrame[] {
    const cues: AudioCueFrame[] = [];
    const landings = beat.parcels.filter(p => p.launchAt !== null).map(p => ({ key: p.key, at: p.restFrom - PARCEL_BEAT.canopyAway, launch: p.launchAt! }));
    if (beat.mode === 'single') {
      const p = landings[0]!;
      cues.push({ id: `${beat.id}:bell`, cue: 'gift-bell', atMs: p.launch + 240, gain: 0.8 }, { id: `${beat.id}:land`, cue: 'parcel-land', atMs: p.at, gain: 1 });
      return cues;
    }
    cues.push({ id: `${beat.id}:roll`, cue: 'cart-roll', atMs: beat.startAt + CART_BEAT.wheels, gain: 0.9 },
      { id: `${beat.id}:bell`, cue: 'gift-bell', atMs: beat.startAt + CART_BEAT.arrive - 300, gain: 1 },
      { id: `${beat.id}:away`, cue: 'cart-roll', atMs: beat.departAt, gain: 0.6 });
    // Each landing knocks for a hamlet; a capital hears one knock per wave, never a drum roll of a hundred.
    const heard = beat.intimate ? landings : landings.filter((_, i) => i % GIFT_LIMITS.wave === 0);
    for (const l of heard.slice(0, 6)) cues.push({ id: `${beat.id}:land:${l.key}`, cue: 'parcel-land', atMs: l.at, gain: beat.intimate ? 0.9 : 0.7 });
    return cues;
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
    /** The room's public presence is unavailable; remove tint without inventing another observation. */
    clearPresence() { presence = null; },
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
    dispose() { disposed = true; cancelTransient(); current.clear(); homes.clear(); celebrated.clear(); presence = null; inFlight.clear(); },
  };
}
export type TwitchMoments = ReturnType<typeof createTwitchMoments>;
