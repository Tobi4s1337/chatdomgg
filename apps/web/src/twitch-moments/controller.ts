import { KingdomPresenceFrameSchema, type KingdomId, type KingdomPresenceFrame } from '@chatdom/shared';
import {
  BANNER_BEAT, BEAT_SPACING_MS, CART_BEAT, FLOURISH_BEAT, GIFT_LIMITS, MOMENT_LIMITS, PARCEL_BEAT, PARCEL_REST_MS, bannerPose, flourishPose, quietFurl,
  ribbonsFor, type BeatPhase,
} from './choreography';
import {
  ACTION_KINDS, ActionResultSchema, ApprovedEffectSchema, CheerLadderSchema, KingdomMomentIntentSchema, MOMENT_CURRENT_LIMIT, MomentResetInfoSchema,
  PresentationSchema, TwitchActionArgsSchema, TwitchActionIntentSchema, TwitchMomentFactSchema, type ActionKind, type ActionPort, type ActionResult,
  type Capability, type KingdomMomentIntent, type MomentBodyOf, type MomentResetInfo, type Presentation, type TwitchActionArgs, type TwitchActionIntent,
  type TwitchMomentFact, type TwitchMomentFeed,
} from './contracts';
import {
  FRIEND, cartLoad, destinationOf, extendGiftBeat, giftSeal, planGiftBeat, recipientLine, type GiftBeat, type GiftDestination, type GiftSeal, type GiftTier,
} from './gift-beat';
import {
  dragonCaption, dragonCues, dragonFocusWindow, dragonFrame, nextBattle, nextTrain, stirCues, stirFrame, stirWindow, trainCaption, trainCues, trainFrame,
  type BattleState, type TrainState,
} from './hype-beat';
import { describeAction } from './previews';
import { RAID_BEAT, RAID_LIMITS, planRaid, raidCaption, raidCues, raidFrame, raidProfile, type RaidBeat, type RaidFrame } from './raid-beat';
import { mergeSky, seedOf, skyCaption, skyCues, skyFrame, skyHold, skyLength, type SkyBeat } from './sky-beat';
import type { TownColour, TownFrame } from './town';
import {
  applyTownState, boardCaption, createTownState, planTownBeat, townCandidate, townCaption, townCues, townFocus, townFrame, townHold, type TownBeat,
} from './town-beat';
import { bannerProfile, battleCandidate, giftProfile, skyProfile, stageCues, stageOf, trainCandidate, type StageCandidate, type StageFrame } from './stage-beat';
import {
  DEFAULT_CHEER_LADDER, SKY_LIMITS, SKY_MERGE_MS, TRAIN_BEAT, rungFor, type ApprovedEffect, type BattleStatus, type DragonFrame, type KingdomScale,
  type LadderStep, type SkyBeatFrame, type SkyRung, type TrainFrame,
} from './spectacle';

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
  /**
   * The realm's authoritative gameplay port for strikes, hauls and the fireworks chant. Null (the default) means no
   * battle can be fought here: an earned train says so honestly and nothing is tallied locally.
   */
  readonly gameplay?: ActionPort<KingdomMomentIntent> | null;
  /** Hamlet: every cheer is its own beat. Town: cheers merge into a volley per 10 s. Capital: per 20 s, names in a ribbon. */
  readonly scale?: KingdomScale;
  /** The monarch's approved fixed ladder; default Twitch.md §6. Invalid ladders fall back to the default. */
  readonly ladder?: readonly LadderStep[];
  /** Spec 24's approved-effect lookup, structurally narrowed. Null means that emote is unavailable for the effect. */
  readonly effect?: (emoteId: string) => ApprovedEffect | null;
  /** The channel's approved emotes a castle volley may burst into; empty bursts as the kingdom's own star. */
  readonly channelEffects?: () => readonly ApprovedEffect[];
  /** The monarch's mapping of custom Power-ups to a fixed moment; unmapped keys are unavailable. */
  readonly customPowerUps?: ReadonlyMap<string, SkyRung | 'confetti'>;
}

export type Tint = 'gold' | 'rose' | 'rainbow';
/** What a shot or a caption is about: a supplied home, or a supplied public place. Never a guessed address. */
export type MomentPlace = 'market' | 'gate' | 'sky' | 'castle' | 'plaza' | 'train' | 'dragon' | 'lair';
export type MomentSubject = { readonly kind: 'home'; readonly slot: number } | { readonly kind: 'place'; readonly place: MomentPlace };
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
export type MomentCue = 'horn' | 'cloth-unfurl' | 'gift-bell' | 'cart-roll' | 'parcel-land'
  // The sky: a spark's climb, a shell's launch and bloom with its crackling tail, the Hearthbeast's call and wings,
  // the aurora's swell, kites on the wind, confetti and a rising balloon.
  | 'spark-rise' | 'firework-launch' | 'firework-bloom' | 'firework-crackle' | 'beast-call' | 'beast-wings' | 'aurora-swell' | 'kite-wind'
  | 'confetti-pop' | 'balloon-rise'
  // The train and the dragon: whistle, steam pulse, coupling, the festival drum; roar, wingbeat, breath, a strike's
  // hit, the fall, a sleeping rumble; the Wyrm Bell and the victory fanfare.
  | 'train-whistle' | 'train-steam' | 'carriage-couple' | 'festival-drum' | 'dragon-roar' | 'dragon-wings' | 'dragon-breath' | 'dragon-hit'
  | 'dragon-fall' | 'dragon-snore' | 'wyrm-bell' | 'victory-fanfare'
  // The town itself: a murmur rising as everyone turns to look, and the cheer that answers the climax.
  | 'crowd-murmur' | 'crowd-cheer';
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
  /**
   * A framing other than the subject's usual one. `garden`: a home's front garden rather than its banner, the house,
   * its door and what grows beside it seen from the street with the words over the door in frame (a sapling, a planted
   * tree, a window answering, a welcome home). `board`: the plaza's decree board seen from across the square, its
   * question and every pennant in frame, rather than the sky over the plaza.
   */
  readonly framing?: 'garden' | 'board';
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
  readonly suppressed: Readonly<Record<'expired' | 'recovered' | 'anonymous' | 'coalesced' | 'unchanged' | 'unapproved', number>>;
  readonly rejected: Readonly<Record<FactRejection | `reset-${ResetRejection}` | 'presence', number>>;
  readonly peak: Readonly<{ beats: number; captions: number; audio: number; current: number; parcels: number; sky: number }>;
  /** The beat admitted last (its stage ID and when it takes the stage), so a capture can find its peak. */
  readonly latest: Readonly<{ id: string; kind: string; startAt: number }> | null;
  /** The last fact taken in (its sequence and kind), whether or not it put a beat on the stage. */
  readonly lastFact: Readonly<{ seq: number; kind: string }> | null;
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
  /** Live sky beats past their start, at most SKY_LIMITS.beats. */
  readonly sky: readonly SkyBeatFrame[];
  readonly train: TrainFrame | null;
  /** The authoritative battle's dragon, or the sleeping stir after a short train. Never a local fight. */
  readonly dragon: DragonFrame | null;
  /** The earned battle's truthful status beside a train at level 3 or more; null when there is nothing to say. */
  readonly battle: BattleStatus | null;
  /**
   * The one observed event the town is attending to: people turn toward it, the lamps hold their breath before its
   * climax and the crowd answers. Null when nothing is staged or the presentation is hidden.
   */
  readonly stage: StageFrame | null;
  /** Incoming raids past their start: the gate's wake and the caravan, at most RAID_LIMITS.caravans. */
  readonly raids: readonly RaidFrame[];
  /** The town as its channel shaped it: the grove, the gate's night, its colours, the decree board, a festival, the bell. */
  readonly town: TownFrame;
}

interface BannerBeat {
  readonly kind: 'home-banner';
  /** A furled or new banner unfurls; one already flying lifts in a gust and gains its ribbon. */
  readonly style: 'unfurl' | 'flourish';
  readonly id: string; readonly slot: number; readonly name: string; readonly line: string; readonly startAt: number; readonly endAt: number;
  readonly newRibbon: boolean;
}
type Beat = BannerBeat | GiftBeat | SkyBeat | RaidBeat | TownBeat;
/** Facts that shape the town: lasting state, and a beat when they happen live. */
const TOWN_KINDS: ReadonlySet<string> = new Set(['follow', 'homecoming', 'night', 'grove', 'decree', 'redemption', 'poll']);
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
/** A town's or capital's cheer waits this long for company before its volley. */
const SKY_GATHER_MS = 1200;

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
  const gameplay = options.gameplay ?? null, scale: KingdomScale = options.scale ?? 'hamlet';
  const ladderInput = CheerLadderSchema.safeParse(options.ladder ?? DEFAULT_CHEER_LADDER);
  const ladder: readonly LadderStep[] = ladderInput.success ? ladderInput.data : DEFAULT_CHEER_LADDER;
  let status: FeedStatus = 'waiting', epoch: string | null = null, watermark = 0, disposed = false;
  const current = new Map<string, TwitchMomentFact>();
  const homes = new Map<number, HomeDress>();
  let beats: Beat[] = [], nextSlotAt = -Infinity, presence: KingdomPresenceFrame | null = null;
  const celebrated = new Set<string>();
  /** Sky keys already played or merged this session, bounded: a replayed key never fires twice. */
  const skySeen = new Set<string>();
  /** Raids already welcomed this session, bounded: a raid is one caravan however often its fact is seen. */
  const raidSeen = new Set<string>();
  let train: TrainState | null = null, battle: BattleState | null = null;
  let town = createTownState();
  const inFlightMoments = new Map<string, Promise<ActionAttempt>>();
  let presentation: Presentation = { layout: 'stage', mood: 'show', busy: false, visible: true, safeRects: [], autoOpenKinds: [] };
  const inFlight = new Map<string, Promise<ActionAttempt>>();
  const metrics = {
    admitted: 0, restored: 0,
    suppressed: { expired: 0, recovered: 0, anonymous: 0, coalesced: 0, unchanged: 0, unapproved: 0 },
    rejected: { 'not-ready': 0, epoch: 0, invalid: 0, kingdom: 0, origin: 0, replay: 0, 'reset-invalid': 0, 'reset-kingdom': 0, 'reset-origin': 0,
      'reset-sequence': 0, 'reset-partial': 0, presence: 0 },
    peak: { beats: 0, captions: 0, audio: 0, current: 0, parcels: 0, sky: 0 },
    latest: null as { id: string; kind: string; startAt: number } | null,
    lastFact: null as { seq: number; kind: string } | null,
  };

  function cancelTransient(): void { beats = []; nextSlotAt = -Infinity; }

  /** Current public state. A live change of a known home eases its cloth quietly; restoration simply is. */
  function applyState(fact: TwitchMomentFact, live: boolean): void {
    const body = fact.body;
    // Cheers, Power-ups and raids are moments, not state: nothing of them lasts in the current view.
    if (body.kind === 'cheer' || body.kind === 'power-up' || body.kind === 'raid') return;
    // A follow, a homecoming and a reward are moments too; only their names and a called festival last (in the town).
    if (body.kind === 'follow' || body.kind === 'homecoming' || (body.kind === 'redemption' && body.key !== 'festival')) {
      applyTownState(town, fact, clock.now(), live);
      return;
    }
    if (body.kind === 'poll') {
      for (const [key, held] of current) if (held.body.kind === 'poll') current.delete(key);
      if (body.phase !== 'end') current.set(body.key, fact);
    } else current.set(body.key, fact);
    metrics.peak.current = Math.max(metrics.peak.current, current.size);
    const now = clock.now(), animate = live && now <= body.displayUntil;
    if (body.kind === 'hype') train = nextTrain(train ?? undefined, body, now, animate);
    if (body.kind === 'battle') battle = nextBattle(battle ?? undefined, body, now, animate);
    if (TOWN_KINDS.has(body.kind)) applyTownState(town, fact, now, animate);
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
    metrics.latest = { id: beat.id, kind: beat.kind, startAt: beat.startAt };
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
    let beat = planGiftBeat(`${body.key}@${fact.seq}`, body, startAt, truncate);
    // The cart drives the same road as a raid's caravan: it waits until the last wagon has gone up the castle road.
    const clear = roadClearAt(now);
    if (beat.mode === 'cart' && clear > startAt) beat = planGiftBeat(beat.id, body, clear, truncate);
    celebrated.add(body.groupKey);
    if (celebrated.size > CELEBRATED_LIMIT) celebrated.delete(celebrated.values().next().value!);
    push(beat, beat.mode === 'cart' ? beat.departAt - beat.startAt : Math.min(beat.endAt - beat.startAt, 5200), now);
  }

  /** An approved effect exactly as the lookup supplied it: valid, and never simulated geometry in a live kingdom. */
  function approved(effect: ApprovedEffect | null | undefined): ApprovedEffect | null {
    const parsed = ApprovedEffectSchema.safeParse(effect);
    if (!parsed.success || (expectedOrigin === 'live' && parsed.data.origin !== 'live')) return null;
    return effect!;
  }

  const remember = (key: string) => { skySeen.add(key); if (skySeen.size > CELEBRATED_LIMIT * 4) skySeen.delete(skySeen.values().next().value!); };

  /**
   * One sky beat per cheer in a hamlet. In a town or capital a cheer joins the volley still gathering (not yet
   * started), which plays its highest rung with a bounded ribbon of names; otherwise it opens the next volley.
   */
  function scheduleSky(fact: TwitchMomentFact, sky: SkyBeat['sky'], rung: SkyRung | null, extra: { effect?: ApprovedEffect | null; bubbleSlot?: number | null } = {}): void {
    const body = fact.body as MomentBodyOf<'cheer'> | MomentBodyOf<'power-up'>;
    if (skySeen.has(body.key)) { metrics.suppressed.coalesced++; return; }
    remember(body.key);
    const now = clock.now(), name = body.credit ? truncate(body.credit.displayName) : FRIEND;
    const window = SKY_MERGE_MS[scale];
    if (sky === 'cheer' && window > 0) {
      const index = beats.findIndex(b => b.kind === 'sky' && b.sky === 'cheer' && now < b.startAt);
      if (index >= 0) {
        const merged = mergeSky(beats[index] as SkyBeat, rung!, name, body.key);
        beats = beats.map((b, i) => (i === index ? merged : b));
        // A volley raised to a grander rung holds the stage for that rung.
        nextSlotAt = Math.max(nextSlotAt, merged.startAt + Math.max(window, skyHold('cheer', merged.rung)));
        metrics.suppressed.coalesced++;
        return;
      }
    }
    // In a town or capital the first cheer plays after a short gather; whoever cheers in the next window joins
    // one shared volley that follows it, so a burst of cheers is a rhythm of volleys, never a queue of fifty.
    const merging = sky === 'cheer' && window > 0;
    const startAt = slot(now, now + (merging ? SKY_GATHER_MS : 0));
    if (startAt === null) return;
    // A spark or a street's fireworks rise from the cheerer's own home; a friend of the realm's from the market.
    const origin: SkyBeat['origin'] = body.credit?.slot != null ? { kind: 'home', slot: body.credit.slot }
      : { kind: 'place', place: sky === 'confetti' ? 'castle' : 'market' };
    const beat: SkyBeat = { kind: 'sky', id: `${body.key}@${fact.seq}`, sky, rung, origin, seed: seedOf(body.key), name, ribbon: [], others: 0,
      effect: extra.effect ?? null, bubbleSlot: extra.bubbleSlot ?? null, keys: [body.key], startAt, endAt: startAt + skyLength(sky, rung) };
    push(beat, merging ? Math.max(window, skyHold(sky, rung)) : skyHold(sky, rung), now);
  }

  function scheduleCheer(fact: TwitchMomentFact, body: MomentBodyOf<'cheer'>): void {
    const rung = rungFor(body.bits, ladder);
    // A castle volley bursts into one of the channel's approved emotes when there are any; otherwise the kingdom's star.
    const pool = rung === 'castle-volley' ? (options.channelEffects?.() ?? []).map(approved).filter((e): e is ApprovedEffect => e !== null) : [];
    scheduleSky(fact, 'cheer', rung, { effect: pool.length ? pool[seedOf(body.key) % pool.length]! : null });
  }

  /**
   * Power-ups: a gigantified emote floats only when its exact approved effect exists (never a stand-in); a
   * message effect dresses the speaker's bubble; a celebration is the castle's confetti; a custom Power-up plays
   * the moment the monarch mapped it to, or nothing.
   */
  function schedulePowerUp(fact: TwitchMomentFact, body: MomentBodyOf<'power-up'>): void {
    switch (body.effect) {
      case 'emote-balloon': {
        const effect = approved(options.effect?.(body.emoteId!) ?? null);
        if (!effect || effect.id !== body.emoteId) { metrics.suppressed.unapproved++; return; }
        scheduleSky(fact, 'balloon', null, { effect });
        return;
      }
      case 'message-effect': scheduleSky(fact, 'bubble', null, { bubbleSlot: body.credit?.slot ?? null }); return;
      case 'celebration': scheduleSky(fact, 'confetti', null); return;
      case 'custom': {
        const mapped = options.customPowerUps?.get(body.mappingKey!);
        if (!mapped) { metrics.suppressed.unapproved++; return; }
        if (mapped === 'confetti') scheduleSky(fact, 'confetti', null); else scheduleSky(fact, 'cheer', mapped);
      }
    }
  }

  /** When the last caravan on the gift road has gone; -Infinity when the road is clear. */
  const roadClearAt = (now: number) => Math.max(-Infinity, ...pending(now).filter((b): b is RaidBeat => b.kind === 'raid').map(b => b.endAt));

  /**
   * One caravan per raid. The gate wakes for one raid at a time: a raid arriving while another holds the gate waits
   * until that gate has gone to sleep and the caravan before it has left the road (so at most two caravans are ever
   * on it), and takes its turn on the stage like any beat. Raids are never merged: each is its own visit, under its
   * own banner. One that could not begin within its display window is not played late.
   */
  function scheduleRaid(fact: TwitchMomentFact, body: MomentBodyOf<'raid'>): void {
    if (raidSeen.has(body.raidKey)) { metrics.suppressed.coalesced++; return; }
    const now = clock.now();
    const raids = pending(now).filter((b): b is RaidBeat => b.kind === 'raid').sort((a, b) => a.startAt - b.startAt);
    if (raids.filter(b => b.startAt > now).length >= RAID_LIMITS.queued) { metrics.suppressed.coalesced++; return; }
    const last = raids.at(-1), before = raids.at(-2);
    const earliest = Math.max(now, last ? last.sleepAt + RAID_BEAT.sleepFade : -Infinity, before ? before.endAt : -Infinity);
    const startAt = slot(now, earliest);
    if (startAt === null) return;
    if (startAt > body.displayUntil) { metrics.suppressed.expired++; return; }
    raidSeen.add(body.raidKey);
    if (raidSeen.size > CELEBRATED_LIMIT) raidSeen.delete(raidSeen.values().next().value!);
    const beat = planRaid(`${body.key}@${fact.seq}`, body, startAt, truncate);
    push(beat, beat.holdUntil - startAt, now);
  }

  /** A town fact's live beat (a sapling, a relight, the gate, a reward, the board, a decree) takes its turn on the stage. */
  function scheduleTown(fact: TwitchMomentFact, colourBefore: TownColour): void {
    const now = clock.now();
    if (!planTownBeat(fact, now, colourBefore, truncate)) return;
    const startAt = slot(now, now);
    if (startAt === null) return;
    if (startAt > fact.body.displayUntil) { metrics.suppressed.expired++; return; }
    const beat = planTownBeat(fact, startAt, colourBefore, truncate)!;
    push(beat, townHold(beat), now);
  }

  function admit(fact: TwitchMomentFact): void {
    const body = fact.body;
    const colourBefore = town.colour;
    const previous = body.kind === 'subscription' && body.credit?.slot != null ? homes.get(body.credit.slot) : undefined;
    applyState(fact, fact.origin !== 'recovered');
    metrics.lastFact = { seq: fact.seq, kind: body.kind };
    const now = clock.now();
    if (fact.origin === 'recovered') { metrics.suppressed.recovered++; return; }
    if (now > body.displayUntil || body.displayUntil === fact.occurredAt) { metrics.suppressed.expired++; return; }
    if (body.kind === 'subscription') scheduleBanner(fact, body, previous);
    else if (body.kind === 'gifts') scheduleGift(fact, body);
    else if (body.kind === 'cheer') scheduleCheer(fact, body);
    else if (body.kind === 'power-up') schedulePowerUp(fact, body);
    else if (body.kind === 'raid') scheduleRaid(fact, body);
    else if (TOWN_KINDS.has(body.kind)) scheduleTown(fact, colourBefore);
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
    cancelTransient(); current.clear(); homes.clear(); train = null; battle = null; town = createTownState();
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
    // The earned dragon outranks everything while it wakes, ends or first takes the sky; then the train's arrival.
    const trainNow = train && visible ? trainFrame(train, atMs) : null;
    const battleStatus: BattleStatus | null = !train || train.level < 3 || (trainNow === null && !battle) ? null
      : battle && battle.phase !== 'victory' && battle.phase !== 'retreat' ? 'battle'
      : battle ? 'ended' : gameplay ? 'requested' : 'unavailable';
    const dragonNow = visible ? (battle ? dragonFrame(battle, atMs) : null) ?? (train ? stirFrame(train, atMs) : null) : null;
    if (visible && battle && dragonNow?.key === battle.battleKey) {
      const words = dragonCaption(battle, atMs);
      if (words) caption(words);
      const window = dragonFocusWindow(battle);
      if (window && atMs >= window[0] && atMs < window[1] && !presentation.busy) {
        focus = { id: `battle.${battle.battleKey}:${battle.phase}`, subject: { kind: 'place', place: 'dragon' }, startAt: window[0], endAt: window[1],
          cut: presentation.mood === 'show', wide: true, follow: null, toward: [] };
      }
    }
    if (trainNow && train) {
      const words = trainCaption(train, atMs, battleStatus ?? 'sleeping');
      if (words) caption(words);
      if (!focus && train.arrives && atMs - train.appearedAt < TRAIN_BEAT.arrive + 4200 && !presentation.busy) {
        focus = { id: `train.${train.trainKey}`, subject: { kind: 'place', place: 'train' }, startAt: train.appearedAt, endAt: train.appearedAt + TRAIN_BEAT.arrive + 4200,
          cut: presentation.mood === 'show', wide: true, follow: null, toward: [] };
      }
    }
    // A short train's ending: the closing fireworks over the castle and, in the hills behind it, the sleeping dragon
    // stirring. One shot from the town side holds both.
    const stir = train ? stirWindow(train) : null;
    if (!focus && train && stir && !presentation.busy) {
      const from = train.endedAt! + TRAIN_BEAT.closing.fireworks[0], until = Math.max(from + skyLength('festival', 'castle-volley'), stir[1]);
      if (atMs >= from && atMs < until) {
        focus = { id: `closing.${train.trainKey}`, subject: { kind: 'place', place: 'castle' }, startAt: from, endAt: until,
          cut: presentation.mood === 'show', wide: true, follow: null, toward: [] };
      }
    }
    for (const beat of live) {
      if (atMs < beat.startAt) continue;
      const t = atMs - beat.startAt;
      if (beat.kind === 'sky') {
        const frame = skyCaption(beat, atMs);
        if (frame) caption(frame);
        // A bubble's dressing is small: it never takes the camera. A balloon is framed as it rises, then drifts on its own.
        const until = beat.sky === 'balloon' ? beat.startAt + 6000 : beat.endAt;
        if (!focus && beat.sky !== 'bubble' && atMs < until && !presentation.busy) {
          // A spark and a street's fireworks rise from the cheerer's own home: the shot is that home and its sky.
          const intimate = beat.sky === 'cheer' && beat.rung === 'spark' && beat.origin.kind === 'home';
          const fromHome = beat.sky === 'cheer' && (beat.rung === 'spark' || beat.rung === 'street-fireworks') && beat.origin.kind === 'home';
          const subject: MomentSubject = fromHome && beat.origin.kind === 'home' ? { kind: 'home', slot: beat.origin.slot }
            : { kind: 'place', place: beat.sky === 'balloon' ? 'plaza' : beat.sky === 'confetti' ? 'castle' : 'sky' };
          focus = { id: beat.id, subject, startAt: beat.startAt, endAt: until, cut: presentation.mood === 'show', wide: !intimate, follow: null,
            toward: beat.origin.kind === 'home' ? [{ kind: 'home', slot: beat.origin.slot }] : [] };
        }
        continue;
      }
      if (beat.kind === 'raid') {
        const words = raidCaption(beat, atMs);
        if (words) caption(words);
        if (!focus && atMs < beat.holdUntil && !presentation.busy) {
          focus = { id: beat.id, subject: { kind: 'place', place: 'gate' }, startAt: beat.startAt, endAt: beat.holdUntil, cut: presentation.mood === 'show', wide: true,
            follow: null, toward: [] };
        }
        continue;
      }
      if (beat.kind === 'town') {
        const words = townCaption(beat, atMs);
        if (words) caption(words);
        const shot = townFocus(beat, presentation.mood === 'show');
        if (!focus && shot && atMs < shot.endAt && !presentation.busy) focus = shot;
        continue;
      }
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
    const add = (cues: readonly AudioCueFrame[]) => { if (audio.length + cues.length <= MOMENT_LIMITS.audio) audio.push(...cues); };
    // The dragon and the train are heard first; then beats in their order on the stage.
    if (visible && battle && dragonNow?.key === battle.battleKey) add(dragonCues(battle, atMs));
    if (visible && train && trainNow) add(trainCues(train));
    if (visible && train && dragonNow?.phase === 'stir') add(stirCues(train));
    for (const beat of live) {
      add(beat.kind === 'home-banner' ? bannerCues(beat) : beat.kind === 'gift' ? giftCues(beat) : beat.kind === 'raid' ? raidCues(beat)
        : beat.kind === 'town' ? townCues(beat) : skyCues(beat));
    }
    // The train's closing fireworks fly over the castle, credited to nobody.
    const sky = live.filter((b): b is SkyBeat => b.kind === 'sky' && atMs >= b.startAt).slice(0, SKY_LIMITS.beats).map(b => skyFrame(b, atMs));
    if (trainNow?.closingFireworks && train?.endedAt != null && Number.isFinite(train.endedAt)) {
      const festival: SkyBeat = { kind: 'sky', id: `festival.${train.trainKey}`, sky: 'festival', rung: 'castle-volley', origin: { kind: 'place', place: 'castle' },
        seed: seedOf(train.trainKey), name: '', ribbon: [], others: 0, effect: null, bubbleSlot: null, keys: [], startAt: train.endedAt + TRAIN_BEAT.closing.fireworks[0],
        endAt: train.endedAt + TRAIN_BEAT.closing.fireworks[0] + skyLength('festival', 'castle-volley') };
      if (atMs >= festival.startAt && atMs < festival.endAt) { sky.push(skyFrame(festival, atMs)); add(skyCues(festival)); }
    }
    // The town attends to one observed beat at a time: the highest-ranked one now playing. Its watchers are the
    // public presence's present people; a stale or absent presence means nobody is known to be there to turn.
    const candidates: StageCandidate[] = [];
    if (visible && battle && dragonNow?.key === battle.battleKey) { const c = battleCandidate(battle); if (c) candidates.push(c); }
    if (trainNow && train) { const c = trainCandidate(train); if (c) candidates.push(c); }
    for (const beat of live) {
      if (atMs < beat.startAt) continue;
      if (beat.kind === 'sky') {
        const profile = skyProfile(beat);
        if (!profile) continue;
        const fromHome = beat.sky === 'cheer' && (beat.rung === 'spark' || beat.rung === 'street-fireworks') && beat.origin.kind === 'home';
        const subject: MomentSubject = fromHome && beat.origin.kind === 'home' ? { kind: 'home', slot: beat.origin.slot }
          : { kind: 'place', place: beat.sky === 'balloon' ? 'plaza' : beat.sky === 'confetti' ? 'castle' : 'sky' };
        candidates.push({ beat: beat.id, subject, startAt: beat.startAt, profile });
      } else if (beat.kind === 'home-banner') {
        candidates.push({ beat: beat.id, subject: { kind: 'home', slot: beat.slot }, startAt: beat.startAt, profile: bannerProfile(beat.style) });
      } else if (beat.kind === 'raid') {
        candidates.push({ beat: beat.id, subject: { kind: 'place', place: 'gate' }, startAt: beat.startAt, profile: raidProfile(beat) });
      } else if (beat.kind === 'town') {
        candidates.push(townCandidate(beat));
      } else {
        const subject: MomentSubject = beat.mode === 'cart' ? { kind: 'place', place: 'market' } : subjectOf(beat.parcels[0]!.to);
        candidates.push({ beat: beat.id, subject, startAt: beat.startAt, profile: giftProfile(beat) });
      }
    }
    const present = presence?.connection === 'fresh' ? presence.windows.filter(w => w.present).length : 0;
    const stage = visible ? stageOf(candidates, atMs, present) : null;
    const raids = live.filter((b): b is RaidBeat => b.kind === 'raid' && atMs >= b.startAt).slice(0, RAID_LIMITS.caravans).map(b => raidFrame(b, atMs));
    if (stage) add(stageCues(stage));
    const townBeats = live.filter((b): b is TownBeat => b.kind === 'town');
    if (visible) { const words = boardCaption(town, atMs, townBeats); if (words) caption(words); }
    metrics.peak.captions = Math.max(metrics.peak.captions, captions.length);
    metrics.peak.audio = Math.max(metrics.peak.audio, audio.length);
    metrics.peak.parcels = Math.max(metrics.peak.parcels, parcels.length);
    metrics.peak.sky = Math.max(metrics.peak.sky, sky.length);
    return { atMs, status, label: expectedOrigin === 'simulated' ? 'SIMULATED' : 'LIVE', visible, homes: homeFrames.sort((a, b) => a.slot - b.slot),
      parcels, carts, captions, audio, focus, sky, train: trainNow, dragon: dragonNow, battle: battleStatus, stage, raids,
      town: townFrame(town, townBeats, atMs, visible) };
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

  /**
   * A strike, haul or fireworks chant goes to the realm's authoritative port and nowhere else. Nothing here tallies
   * damage or declares victory: the battle's result returns as a fact. Without a port the answer is unavailable.
   */
  function submitMoment(input: unknown): Promise<ActionAttempt> {
    const intent = KingdomMomentIntentSchema.safeParse(input);
    if (!intent.success) return Promise.resolve({ status: 'invalid', intentId: null });
    const { id } = intent.data, kind = intent.data.args.kind;
    const same = inFlightMoments.get(id);
    if (same) return same;
    if ([...inFlightMoments.keys()].some(key => key.endsWith(`|${kind}`))) return Promise.resolve({ status: 'in-flight', intentId: id });
    if (!gameplay || !(gameplay.capabilities().get(kind) ?? UNAVAILABLE).available) return Promise.resolve({ status: 'unavailable', intentId: id });
    const attempt = gameplay.submit(intent.data, new AbortController().signal).then(result => {
      const parsed = ActionResultSchema.safeParse(result);
      return parsed.success && parsed.data.intentId === id ? parsed.data : { status: 'unknown' as const, intentId: id, reconciliationKey: id };
    }, () => ({ status: 'unknown' as const, intentId: id, reconciliationKey: id }))
      .finally(() => { inFlightMoments.delete(id); inFlightMoments.delete(`${id}|${kind}`); });
    inFlightMoments.set(id, attempt); inFlightMoments.set(`${id}|${kind}`, attempt);
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
    submitMoment,
    /** The realm's answer for each kingdom act; every one is unavailable when no gameplay port is bound. */
    momentCapabilities: (): ReadonlyMap<KingdomMomentIntent['args']['kind'], Capability> =>
      gameplay?.capabilities() ?? new Map((['strike', 'haul', 'fireworks-chant'] as const).map(kind => [kind, UNAVAILABLE])),
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
    dispose() {
      disposed = true; cancelTransient(); current.clear(); homes.clear(); celebrated.clear(); skySeen.clear(); raidSeen.clear(); presence = null; inFlight.clear();
      inFlightMoments.clear(); train = null; battle = null; town = createTownState();
    },
  };
}
export type TwitchMoments = ReturnType<typeof createTwitchMoments>;
