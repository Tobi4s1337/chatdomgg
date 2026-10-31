import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, TokenSchema } from '@chatdom/shared';
import { BODY_FAMILIES, COMMON_WEARABLES, HAIR_FORMS, type BodyFamily, type HairForm, type WearableId, type WearableStyle } from '@chatdom/content/avatars';
import { AVATAR_PALETTE } from '@chatdom/content/materials';
import { array, bool, check, int, literal, nullable, object, oneOf, text, type Decoder } from './decode';

/*
 * Campfire presentation ports, version 1. These are lane-local integration seams (spec 21,
 * "Campfire presentation boundary"); main promotes the cross-process messages into shared before
 * real routes launch. Only `CampfirePublicView` may reach a public surface, recorder or stream.
 */

export const CAMPFIRE_PORT_VERSION = 1;
export const CAMPFIRE_MAX_SEATS = 12;
export const DUSK_COURT_MIN_PLAYERS = 5;
export const DUSK_COURT_MAX_PLAYERS = 11;
export const DUSK_COURT_MAX_DAYS = 8;

export const DUSK_COURT_ROLES = ['snuffer', 'watchman', 'lamplighter', 'fool', 'townsfolk'] as const;
export type DuskCourtRole = (typeof DUSK_COURT_ROLES)[number];
export const CAMPFIRE_PHASES = ['dusk', 'night', 'dawn', 'discussion', 'ballot', 'runoff', 'verdict', 'ending'] as const;
export type CampfirePhaseId = (typeof CAMPFIRE_PHASES)[number];
export const CAMPFIRE_TIMINGS = ['hearth', 'unhurried'] as const;
export type CampfireTiming = (typeof CAMPFIRE_TIMINGS)[number];
/**
 * closed: the fire is banked; gathering: people may sit and talk, no game; seating: a game is open and
 * its seats are being offered/drawn; playing/paused: a match is running; ended/interrupted: its last word.
 */
export const CAMPFIRE_LIFECYCLES = ['closed', 'gathering', 'seating', 'playing', 'paused', 'ended', 'interrupted'] as const;
export type CampfireLifecycle = (typeof CAMPFIRE_LIFECYCLES)[number];
export const CAMPFIRE_OUTCOMES = ['town', 'snuffers', 'fool', 'draw', 'interrupted'] as const;
export type CampfireOutcome = (typeof CAMPFIRE_OUTCOMES)[number];
export type CampfireOrigin = 'LIVE' | 'SIMULATED';

/** A seat's public appearance, as authored library choices. Never an inventory or ownership record. */
export interface CampfireSeatLook {
  readonly body: BodyFamily;
  readonly skin: (typeof AVATAR_PALETTE.skin)[number];
  readonly hair: { readonly form: HairForm; readonly swatch: (typeof AVATAR_PALETTE.hair)[number] } | null;
  readonly wear: readonly { readonly id: WearableId; readonly style: WearableStyle }[];
}

export interface CampfirePublicSeat {
  /** Index into the clearing's seat arrangement; 0 is always the Magistrate's seat when present. */
  readonly seat: number;
  readonly kind: 'magistrate' | 'player';
  readonly label: string;
  readonly look: CampfireSeatLook;
  /** away: the seat is held for a reconnect; departed: someone left the fire (no reason is public). */
  readonly presence: 'seated' | 'away' | 'departed';
  /** How this seat takes part. The reason a seat is text-only is never public. */
  readonly medium: 'voice' | 'text';
  /** The game token beside the log. A citizen's own presence light is never touched by the game. */
  readonly lantern: 'lit' | 'out' | 'none';
  /** Only after an authorized public reveal: an extinguished lantern's verdict/dawn or the game's end. */
  readonly revealed: DuskCourtRole | null;
}

export interface CampfirePublicPhase {
  readonly id: CampfirePhaseId;
  readonly day: number;
  readonly startedAtMs: number;
  /** Server deadline; null while paused. */
  readonly deadlineMs: number | null;
  readonly pausedRemainingMs: number | null;
}

export interface CampfireSettings {
  readonly family: 'dusk-court';
  readonly rulesVersion: string;
  readonly timing: CampfireTiming;
  readonly players: number;
}

export interface CampfireSeating {
  readonly open: boolean;
  /** Seats the draw is filling and seats already accepted. Never the candidate roster. */
  readonly seats: number;
  readonly accepted: number;
  readonly deadlineMs: number | null;
}

export interface CampfireGallery {
  readonly open: boolean;
  readonly deadlineMs: number | null;
  /** The host's frozen stream-delay allowance for today. */
  readonly delay: { readonly ms: number; readonly estimated: boolean };
  /** Advisory suspicion as relative glow; equal leaders share the same glow. No counts. */
  readonly embers: readonly { readonly seat: number; readonly glow: 1 | 2 | 3 }[];
}

export interface CampfireVoiceStatus {
  readonly mode: 'text' | 'push-to-talk' | 'open-mic';
  /** True when enforcement is unknown: everyone is silent until authority returns. */
  readonly quiet: boolean;
}

/** An approved, fact-referenced public line. Only witnessed things are said. */
export interface CampfireCue {
  readonly id: string;
  readonly fact: string;
  readonly atMs: number;
  readonly text: string;
}

export interface CampfireResult {
  readonly outcome: CampfireOutcome;
  readonly day: number;
  readonly reveals: readonly { readonly seat: number; readonly role: DuskCourtRole }[];
}

export interface CampfirePublicView {
  readonly version: typeof CAMPFIRE_PORT_VERSION;
  readonly kingdom: { readonly id: string; readonly name: string };
  readonly matchId: string | null;
  readonly hostEpoch: string;
  readonly revision: number;
  readonly serverTimeMs: number;
  readonly origin: CampfireOrigin;
  readonly lifecycle: CampfireLifecycle;
  readonly phase: CampfirePublicPhase | null;
  readonly settings: CampfireSettings | null;
  readonly seating: CampfireSeating | null;
  readonly seats: readonly CampfirePublicSeat[];
  readonly gallery: CampfireGallery | null;
  readonly voice: CampfireVoiceStatus;
  readonly cues: readonly CampfireCue[];
  readonly result: CampfireResult | null;
}

const zod = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, reason: string): Decoder<T> => (value, path) => {
  const parsed = schema.safeParse(value);
  check(parsed.success, path, reason);
  return (parsed as { data: T }).data;
};
const epochMs = zod(EpochMsSchema, 'expected server epoch milliseconds');
const token = zod(TokenSchema, 'expected a token');
const kingdomId = zod(KingdomIdSchema, 'expected a decimal kingdom ID');
// Labels are display names: never looked up as an identity. Bounded for a nameplate.
const label: Decoder<string> = (value, path) => text(40)(zod(DisplayNameSchema, 'expected a display name')(value, path), path);
const seatIndex = int(0, CAMPFIRE_MAX_SEATS - 1);
const role = oneOf(DUSK_COURT_ROLES);

const look: Decoder<CampfireSeatLook> = object({
  body: oneOf(BODY_FAMILIES),
  skin: (value, path) => { check((AVATAR_PALETTE.skin as readonly unknown[]).includes(value), path, 'expected a skin swatch'); return value as CampfireSeatLook['skin']; },
  hair: nullable(object({
    form: oneOf(HAIR_FORMS),
    swatch: (value, path) => { check((AVATAR_PALETTE.hair as readonly unknown[]).includes(value), path, 'expected a hair swatch'); return value as (typeof AVATAR_PALETTE.hair)[number]; },
  })),
  wear: array(object({ id: oneOf(COMMON_WEARABLES), style: oneOf(['hearth', 'tide'] as const) }), 8),
});

const seat: Decoder<CampfirePublicSeat> = object({
  seat: seatIndex, kind: oneOf(['magistrate', 'player'] as const), label, look,
  presence: oneOf(['seated', 'away', 'departed'] as const), medium: oneOf(['voice', 'text'] as const),
  lantern: oneOf(['lit', 'out', 'none'] as const), revealed: nullable(role),
});

const phase: Decoder<CampfirePublicPhase> = object({
  id: oneOf(CAMPFIRE_PHASES), day: int(1, DUSK_COURT_MAX_DAYS), startedAtMs: epochMs,
  deadlineMs: nullable(epochMs), pausedRemainingMs: nullable(int(0, 10 * 60_000)),
});

const decodeView = object({
  version: literal(CAMPFIRE_PORT_VERSION),
  kingdom: object({ id: kingdomId, name: text(64) }),
  matchId: nullable(token), hostEpoch: token, revision: int(0, Number.MAX_SAFE_INTEGER), serverTimeMs: epochMs,
  origin: oneOf(['LIVE', 'SIMULATED'] as const),
  lifecycle: oneOf(CAMPFIRE_LIFECYCLES),
  phase: nullable(phase),
  settings: nullable(object({ family: literal('dusk-court'), rulesVersion: token, timing: oneOf(CAMPFIRE_TIMINGS), players: int(DUSK_COURT_MIN_PLAYERS, DUSK_COURT_MAX_PLAYERS) })),
  seating: nullable(object({ open: bool, seats: int(DUSK_COURT_MIN_PLAYERS, DUSK_COURT_MAX_PLAYERS), accepted: int(0, DUSK_COURT_MAX_PLAYERS), deadlineMs: nullable(epochMs) })),
  seats: array(seat, CAMPFIRE_MAX_SEATS),
  gallery: nullable(object({
    open: bool, deadlineMs: nullable(epochMs),
    delay: object({ ms: int(0, 60_000), estimated: bool }),
    embers: array(object({ seat: seatIndex, glow: (value, path) => int(1, 3)(value, path) as 1 | 2 | 3 }), DUSK_COURT_MAX_PLAYERS),
  })),
  voice: object({ mode: oneOf(['text', 'push-to-talk', 'open-mic'] as const), quiet: bool }),
  cues: array(object({ id: token, fact: token, atMs: epochMs, text: text(200) }), 8),
  result: nullable(object({
    outcome: oneOf(CAMPFIRE_OUTCOMES), day: int(1, DUSK_COURT_MAX_DAYS),
    reveals: array(object({ seat: seatIndex, role }), DUSK_COURT_MAX_PLAYERS),
  })),
});

const IN_MATCH: readonly CampfireLifecycle[] = ['playing', 'paused', 'ended', 'interrupted'];

/**
 * Decodes one public view. Beyond the allowlist it checks the reveal boundary structurally: a role
 * appears only beside an extinguished lantern or in a finished game's result, and never on the
 * Magistrate. A view that breaks those rules is rejected, not filtered.
 */
export function decodeCampfirePublicView(value: unknown): CampfirePublicView {
  const view = decodeView(value, 'publicView') as CampfirePublicView;
  const seen = new Set<number>();
  const magistrates = view.seats.filter(s => s.kind === 'magistrate');
  check(magistrates.length <= 1, 'publicView.seats', 'has more than one Magistrate');
  check(magistrates.every(s => s.seat === 0) && view.seats.every(s => s.kind === 'magistrate' || s.seat > 0), 'publicView.seats', 'seat 0 belongs to the Magistrate');
  const players = view.seats.filter(s => s.kind === 'player').length;
  check(players <= DUSK_COURT_MAX_PLAYERS, 'publicView.seats', 'has too many players');
  const finished = view.lifecycle === 'ended' && view.result !== null && view.result.outcome !== 'interrupted';
  for (const [i, s] of view.seats.entries()) {
    const at = `publicView.seats[${i}]`;
    check(!seen.has(s.seat), at, 'repeats a seat');
    seen.add(s.seat);
    if (s.kind === 'magistrate') check(s.lantern === 'none' && s.revealed === null, at, 'the Magistrate holds no role or lantern');
    if (s.revealed !== null) check(s.lantern === 'out' || finished, at, 'reveals a role before its public reveal');
    if (!IN_MATCH.includes(view.lifecycle)) check(s.lantern === 'none', at, 'lights a game lantern outside a match');
  }
  check(IN_MATCH.includes(view.lifecycle) === (view.matchId !== null && view.settings !== null), 'publicView.matchId', 'must exist exactly while a match exists');
  check((view.lifecycle === 'playing' || view.lifecycle === 'paused') === (view.phase !== null), 'publicView.phase', 'exists only while a match is running');
  check(view.lifecycle !== 'paused' || view.phase?.deadlineMs === null, 'publicView.phase', 'a paused phase has no running deadline');
  check((view.lifecycle === 'ended' || view.lifecycle === 'interrupted') === (view.result !== null), 'publicView.result', 'exists only when a match has finished');
  check(view.lifecycle !== 'interrupted' || (view.result?.outcome === 'interrupted' && view.result.reveals.length === 0), 'publicView.result', 'an interrupted night reveals nothing');
  check(view.seating === null || view.lifecycle === 'seating', 'publicView.seating', 'exists only while seats are offered');
  if (view.gallery) for (const ember of view.gallery.embers) {
    const target = view.seats.find(s => s.seat === ember.seat);
    check(target?.kind === 'player' && target.lantern === 'lit', 'publicView.gallery.embers', 'suspicion may only rest beside a living player');
  }
  if (view.result) for (const reveal of view.result.reveals) check(view.seats.some(s => s.seat === reveal.seat && s.kind === 'player'), 'publicView.result.reveals', 'reveals a seat that did not play');
  return view;
}

/*
 * The private envelope's types live here so the session port can name them; its decoder lives in
 * a separate module that public surfaces never import.
 */
export interface CampfireSelfView {
  readonly version: typeof CAMPFIRE_PORT_VERSION;
  readonly matchId: string;
  readonly hostEpoch: string;
  readonly revision: number;
  readonly seat: { readonly seat: number; readonly generation: number; readonly leaseExpiresAtMs: number };
  /** Null until the dusk card is dealt. */
  readonly role: DuskCourtRole | null;
  /** Fellow Snuffers' seats, only for a Snuffer. */
  readonly knownSnuffers: readonly number[];
  readonly choice: CampfireChoice | null;
  readonly receipts: readonly { readonly intent: string; readonly status: 'received' }[];
  readonly inspections: readonly { readonly day: number; readonly seat: number; readonly finding: 'snuffer' | 'not-snuffer' }[];
  readonly voice: { readonly eligibility: 'voice' | 'text'; readonly reason: 'declined' | 'consent' | 'eligibility' | 'moderation' | 'offline' | null };
}

/** The one choice open to this seat now. Night cards exist for every role, including a rest card. */
export interface CampfireChoice {
  readonly kind: 'night' | 'ballot' | 'runoff';
  readonly deadlineMs: number;
  readonly targets: readonly number[];
  readonly allowNone: boolean;
}

export interface CampfireSelfEnvelope { readonly self: CampfireSelfView; readonly public: CampfirePublicView }

export type CampfireIntent =
  | { readonly kind: 'join-lottery' }
  | { readonly kind: 'accept-seat'; readonly offer: string; readonly medium: 'voice' | 'text' }
  | { readonly kind: 'decline-seat'; readonly offer: string }
  | { readonly kind: 'leave-seat' }
  | { readonly kind: 'night'; readonly target: number | null }
  | { readonly kind: 'ballot'; readonly target: number | null }
  | { readonly kind: 'open-gathering' }
  | { readonly kind: 'close-gathering' }
  | { readonly kind: 'open-game'; readonly timing: CampfireTiming; readonly players: number }
  | { readonly kind: 'start-draw' }
  | { readonly kind: 'invite'; readonly login: string }
  | { readonly kind: 'voice-mode'; readonly mode: CampfireVoiceStatus['mode'] };

export interface CampfireIntentEnvelope {
  readonly id: string;
  readonly matchId: string | null;
  readonly hostEpoch: string;
  readonly expectedRevision: number;
  readonly intent: CampfireIntent;
}

export type CampfireReceipt =
  | { readonly id: string; readonly status: 'pending' | 'accepted' }
  | { readonly id: string; readonly status: 'rejected'; readonly reason: 'stale' | 'not-allowed' | 'invalid' | 'unavailable' };

/**
 * The browser never selects an actor: the session is already bound to one authenticated principal
 * (or to none). Unsubscribing or disposing clears any private state the port held.
 */
export interface CampfireSessionPort {
  readonly origin: CampfireOrigin;
  subscribePublic(listener: (view: CampfirePublicView) => void): () => void;
  subscribeSelf(listener: (envelope: CampfireSelfEnvelope) => void, unavailable: (reason: 'signed-out' | 'not-seated' | 'not-bound') => void): () => void;
  send(envelope: CampfireIntentEnvelope): Promise<CampfireReceipt>;
  dispose(): void;
}

export type CampfireVoiceStatusDetail = 'off' | 'requesting' | 'connecting' | 'live' | 'reconnecting' | 'quiet' | 'denied' | 'unsupported';

/** One replaceable SDK adapter sits behind this; untrusted UI gets no participant-admin calls. */
export interface CampfireVoicePort {
  connect(gesture: { readonly trusted: true }): Promise<CampfireVoiceStatusDetail>;
  disconnect(): void;
  setTalking(talking: boolean): void;
  observe(listener: (state: { readonly status: CampfireVoiceStatusDetail; readonly levels: ReadonlyMap<number, number> }) => void): () => void;
  /** Monarch/Watch controls go to the host, which alone confirms a removed mic. */
  request(control: { readonly kind: 'silence-seat' | 'unseat'; readonly seat: number; readonly reason: string }): Promise<CampfireReceipt>;
}

/** The kingdom's existing audio context and bus; the campfire owns only its effect layer. */
export interface CampfireAudioPort {
  readonly context: AudioContext | null;
  readonly destination: AudioNode | null;
  readonly unlocked: boolean;
  onKill(listener: () => void): () => void;
  duck(amount: number, atSeconds: number): void;
  playCue(cue: CampfireCue): Promise<'played' | 'unavailable'>;
}

/** Seat placements, soles on the ground; +Z forward, metres, server milliseconds. No teleport authority. */
export interface CampfireSeatAnchor {
  readonly seat: number;
  readonly soles: readonly [number, number, number];
  readonly heading: number;
  readonly head: readonly [number, number, number];
}

export type CampfireShot = 'establishing' | 'pair' | 'face' | 'lantern';
export interface CampfireShotSuggestion {
  readonly shot: CampfireShot;
  readonly seats: readonly number[];
  readonly priority: number;
  readonly expiresAtMs: number;
  readonly reason: 'gathering' | 'discussion' | 'suspicion' | 'dawn' | 'verdict' | 'ending';
}

export interface CampfireScenePort {
  seats(): readonly CampfireSeatAnchor[];
  /** Waypoints (soles) from the kingdom path to a seat, avoiding logs and the hearth. */
  approach(seat: number): readonly (readonly [number, number, number])[];
  suggestions(view: CampfirePublicView, atMs: number): readonly CampfireShotSuggestion[];
}
